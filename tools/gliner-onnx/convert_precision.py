"""Reproducible FP16 candidates from the immutable public FP32 exports.

Run with: uv run --project tools/gliner-onnx --locked python tools/gliner-onnx/convert_precision.py
Attribute heads remain FP32. Browser qualification is a separate mandatory step.
"""
import argparse, hashlib, json, time
from pathlib import Path
import onnx
from onnxruntime.transformers.float16 import convert_float_to_float16
from onnxruntime.transformers.onnx_model import OnnxModel

ROOT = Path(__file__).resolve().parents[2]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', choices=['p10', 'bpsd'])
    args = parser.parse_args()
    for profile in ([args.profile] if args.profile else ['p10', 'bpsd']):
        source = next(p for p in (ROOT/'work'/('final-r2-'+profile)).iterdir() if p.is_dir())/'model.onnx'
        out = ROOT/'work/precision'/profile
        out.mkdir(parents=True, exist_ok=True)
        precision = 'fp16'
        target = out/('model-'+precision+'.onnx')
        start = time.monotonic()
        model = convert_float_to_float16(onnx.load(source), keep_io_types=True)
        OnnxModel(model).topological_sort()
        onnx.checker.check_model(model)
        onnx.save(model, target)
        del model
        with target.open('rb') as stream:
            sha = hashlib.file_digest(stream, 'sha256').hexdigest()
        result = {'profile':profile, 'precision':precision, 'bytes':target.stat().st_size,
                  'sha256':sha, 'conversionSeconds':time.monotonic()-start,
                  'method':'float16-keep-io-fp32'}
        (out/(precision+'.json')).write_text(json.dumps(result, indent=2)+'\n')
        print(json.dumps(result), flush=True)

if __name__ == '__main__':
    main()
