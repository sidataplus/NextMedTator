"""Reproducible precision candidates from the immutable public FP32 exports.

Run with: uv run --project tools/gliner-onnx --locked python tools/gliner-onnx/convert_precision.py
Attribute heads remain FP32. Browser qualification is a separate mandatory step.
"""
import argparse, hashlib, json, time
from pathlib import Path
import onnx
import numpy as np
from onnx import numpy_helper,helper
from onnxruntime.transformers.float16 import convert_float_to_float16
from onnxruntime.transformers.onnx_model import OnnxModel
from onnxruntime.quantization import quantize_dynamic, QuantType

ROOT = Path(__file__).resolve().parents[2]

def captures(graph):
    defined={v.name for v in graph.input}|{v.name for v in graph.initializer}
    defined.update(output for node in graph.node for output in node.output)
    return set().union(*(dependencies(node) for node in graph.node))-defined

def dependencies(node):
    needed=set(node.input)-{''}
    for attr in node.attribute:
        if attr.type==onnx.AttributeProto.GRAPH:needed.update(captures(attr.g))
        elif attr.type==onnx.AttributeProto.GRAPHS:
            for graph in attr.graphs:needed.update(captures(graph))
    return needed

def sort_with_captures(graph,outer=()):
    """ORT's quantizer reorders If nodes without their implicit outer inputs."""
    available=set(outer)|{v.name for v in graph.input}|{v.name for v in graph.initializer}
    pending=list(graph.node);ordered=[]
    while pending:
        remaining=[]
        for node in pending:
            if not dependencies(node)<=available:
                remaining.append(node);continue
            for attr in node.attribute:
                if attr.type==onnx.AttributeProto.GRAPH:sort_with_captures(attr.g,available)
                elif attr.type==onnx.AttributeProto.GRAPHS:
                    for child in attr.graphs:sort_with_captures(child,available)
            ordered.append(node);available.update(node.output)
        if len(remaining)==len(pending):raise ValueError('Unresolved ONNX dependency')
        pending=remaining
    del graph.node[:];graph.node.extend(ordered)

def quantize_weights(model):
    """INT8 storage with FP32 activations: avoids dynamic activation outliers.

    Per-output-channel matrices and per-row embeddings. CPU can fold constant
    dequantization; this saves download bytes, not necessarily runtime memory.
    """
    axes={}
    for node in model.graph.node:
        if not node.name.startswith('/encoder/'):continue
        if node.op_type=='MatMul':axes[node.input[1]]=1
        elif node.op_type=='Gather':axes[node.input[0]]=0
    tensors=[];nodes=[]
    for tensor in model.graph.initializer:
        if tensor.name not in axes or tensor.data_type!=onnx.TensorProto.FLOAT or len(tensor.dims)!=2:
            tensors.append(tensor);continue
        axis=axes[tensor.name];weights=numpy_helper.to_array(tensor)
        scale=np.maximum(np.max(np.abs(weights),axis=1-axis)/127,np.finfo(np.float32).tiny).astype(np.float32)
        broadcast=scale[:,None] if axis==0 else scale[None,:]
        quantized=np.clip(np.rint(weights/broadcast),-127,127).astype(np.int8)
        names=[tensor.name+suffix for suffix in ['_int8','_scale','_zero']]
        tensors.extend([numpy_helper.from_array(quantized,names[0]),numpy_helper.from_array(scale,names[1]),numpy_helper.from_array(np.zeros_like(scale,dtype=np.int8),names[2])])
        nodes.append(helper.make_node('DequantizeLinear',names,[tensor.name],name=tensor.name+'_dequantize',axis=axis))
    del model.graph.initializer[:];model.graph.initializer.extend(tensors)
    model.graph.node.extend(nodes);sort_with_captures(model.graph)
    return model

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', choices=['p10', 'bpsd'])
    parser.add_argument('--precision', choices=['fp16', 'int8'])
    parser.add_argument('--int8-mode',choices=['weight-only','dynamic'],default='weight-only')
    args = parser.parse_args()
    for profile in ([args.profile] if args.profile else ['p10', 'bpsd']):
        source = next(p for p in (ROOT/'work'/('final-r2-'+profile)).iterdir() if p.is_dir())/'model.onnx'
        out = ROOT/'work/precision'/profile
        out.mkdir(parents=True, exist_ok=True)
        for precision in ([args.precision] if args.precision else ['fp16', 'int8']):
            target = out/('model-'+precision+'.onnx')
            start = time.monotonic()
            if precision == 'fp16':
                model = convert_float_to_float16(onnx.load(source), keep_io_types=True)
                OnnxModel(model).topological_sort()
                onnx.checker.check_model(model)
                onnx.save(model, target)
                del model
            else:
                original=onnx.load(source)
                if args.int8_mode=='weight-only':
                    onnx.save(quantize_weights(original),target)
                    del original
                else:
                    selected=[node.name for node in original.graph.node
                          if node.op_type=='MatMul' and node.name.startswith('/encoder/')]
                    del original
                    quantize_dynamic(source, target, weight_type=QuantType.QInt8,
                                     per_channel=True, op_types_to_quantize=['MatMul'],nodes_to_quantize=selected)
                model=onnx.load(target)
                sort_with_captures(model.graph)
                onnx.save(model,target)
                del model
                onnx.checker.check_model(str(target))
            with target.open('rb') as stream:
                sha = hashlib.file_digest(stream, 'sha256').hexdigest()
            result = {'profile':profile, 'precision':precision, 'bytes':target.stat().st_size,
                      'sha256':sha, 'conversionSeconds':time.monotonic()-start,
                      'method':'float16-keep-io-fp32' if precision=='fp16' else args.int8_mode}
            (out/(precision+'.json')).write_text(json.dumps(result, indent=2)+'\n')
            print(json.dumps(result), flush=True)

if __name__ == '__main__':
    main()
