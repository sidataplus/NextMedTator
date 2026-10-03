"""External source/export diagnosis; never changes a graph or model weights.

Run in the pinned official-source qualification runtime with onnx 1.20.1 and
onnxruntime 1.30.0. A passing diagnostic identifies the known defect; it does
not qualify automatic relations. A corrected export needs new source fixtures.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from gliner2 import AutoExtractor
from gliner2.models.boundary.relations import RelationPairBatch
from onnx import numpy_helper


def run(source, export, output):
    torch.set_num_threads(1)
    model = AutoExtractor.from_pretrained(str(source), map_location='cpu', local_files_only=True)
    model.eval()
    graph_path = export / 'onnx/heads.onnx'
    graph = onnx.load(str(graph_path))
    constants = {
        node.output[0]: numpy_helper.to_array(next(a.t for a in node.attribute if a.name == 'value'))
        for node in graph.graph.node
        if node.op_type == 'Constant' and any(a.name == 'value' for a in node.attribute)
    }
    # Inspect the positional distance path, not unrelated MLP/content divisions.
    distance = next(node for node in graph.graph.node if node.op_type == 'Div' and node.input[0] == '/Abs_output_0')
    divisor = float(constants[distance.input[1]])
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.log_severity_level = 3
    session = ort.InferenceSession(str(graph_path), options, providers=['CPUExecutionProvider'])
    rng = np.random.default_rng(431)
    hidden = model.relation_scorer.hidden_size
    states = rng.normal(0, .1, (1, 96, hidden)).astype(np.float32)
    roles = rng.normal(0, .1, (1, 1, 2 * hidden)).astype(np.float32)
    pairs = RelationPairBatch(
        batch_index=torch.tensor([0, 0]), relation_index=torch.tensor([0, 0]),
        head_start=torch.tensor([0, 1]), head_end=torch.tensor([1, 2]),
        tail_start=torch.tensor([2, 4]), tail_end=torch.tensor([3, 5]),
        head_prob=torch.ones(2), tail_prob=torch.ones(2), pair_mask=torch.ones(2, dtype=torch.bool),
    )
    results = []
    for length in [6, 16, 48, 96]:
        feeds = {'text_states': states[:, :length], 'rel_states': roles}
        for name in ['head_start', 'head_end', 'tail_start', 'tail_end']:
            feeds[name] = getattr(pairs, name).numpy()[None, :]
        feeds['rel_index'] = pairs.relation_index.numpy()[None, :]
        feeds['pair_mask'] = np.ones((1, 2), dtype=np.float32)
        native = session.run(['rel_logits'], feeds)[0].reshape(-1)
        with torch.no_grad():
            reference = model.relation_scorer(torch.from_numpy(feeds['text_states']), torch.from_numpy(roles), None, pairs).numpy()
        error = float(np.max(np.abs(native - reference)))
        results.append({'words': length, 'sourceLogits': reference.tolist(), 'exportLogits': native.tolist(), 'maxAbsoluteError': error, 'passesSourceTolerance': bool(np.allclose(native, reference, atol=1e-4, rtol=1e-4))})
    report = {'scope': 'Published relation graph defect diagnosis, not relation qualification', 'distanceDivisor': divisor, 'requiredDivisor': 'current text_states word dimension', 'lengths': results, 'automaticRelationsQualified': False}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    assert divisor == 48 and results[2]['passesSourceTolerance'] and any(not r['passesSourceTolerance'] for r in results if r['words'] != 48), 'Known defect changed; investigate before updating qualification'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--export', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=Path('test-results/relation-export-diagnosis.json'))
    args = parser.parse_args()
    run(args.source, args.export, args.out)
