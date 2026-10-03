"""Export the GLiNER2.5 span-attribute head that the published boundary package omits.

The published DanKau graphs are the encoder and the candidate-proposal boundary head.
Assertion, temporality, and experiencer are span attributes: the same boundary head
scores caller-supplied spans through ``score_explicit_spans``. This script loads
``fastino/gliner2.5-base-v1`` and writes that head to ``explicit.onnx``. It does not
download weights and it does not write them into the repository.

Point --checkpoint at a local directory containing model.safetensors, config.json,
encoder_config/config.json, and tokenizer.json. --out is the ONNX file.
"""
import argparse
from pathlib import Path

import torch
import torch.nn as nn


class ExplicitSpanModule(nn.Module):
    def __init__(self, head):
        super().__init__()
        self.head = head

    def forward(self, token_states, text_mask, query_states, query_mask, indices):
        return self.head.score_explicit_spans(
            token_states, text_mask, query_states, query_mask, indices
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--gliner', type=Path, default=Path('/tmp/gliner/GLiNER2'))
    args = parser.parse_args()
    import sys
    sys.path.insert(0, str(args.gliner))
    from gliner2 import AutoExtractor

    torch.manual_seed(0)
    # ORT Web has no EyeLike kernel. The boundary attention diagonal is a boolean identity.
    def ort_eye(n, m=None, *, dtype=None, device=None, **kwargs):
        m = n if m is None else m
        rows = torch.arange(n, device=device).view(-1, 1)
        cols = torch.arange(m, device=device).view(1, -1)
        out = rows == cols
        return out if dtype is None or dtype == torch.bool else out.to(dtype)
    torch.eye = ort_eye
    model = AutoExtractor.from_pretrained(str(args.checkpoint), map_location='cpu')
    model.eval()
    module = ExplicitSpanModule(model.boundary_head).eval()
    # The boundary encoder's length is consumed as a Python dimension, so this
    # export fixes the word axis. 512 is the encoder window and the pad length
    # the decoder uses; text_mask drops the padding.
    words, queries, spans, hidden = 512, 3, 2, model.hidden_size
    token_states = torch.randn(1, words, hidden)
    text_mask = torch.ones(1, words, dtype=torch.bool)
    query_states = torch.randn(1, queries, hidden)
    query_mask = torch.ones(1, queries, dtype=torch.bool)
    indices = torch.zeros(1, queries, spans, 2, dtype=torch.long)
    indices[..., 0] = 1
    indices[..., 1] = 4
    with torch.no_grad():
        reference = module(token_states, text_mask, query_states, query_mask, indices)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    queries_dim = torch.export.Dim('queries', min=1, max=64)
    spans_dim = torch.export.Dim('spans', min=1, max=64)
    torch.onnx.export(
        module,
        (token_states, text_mask, query_states, query_mask, indices),
        str(args.out),
        input_names=['token_states', 'text_mask', 'query_states', 'query_mask', 'indices'],
        output_names=['logits'],
        opset_version=18,
        dynamo=True,
        dynamic_shapes=(
            None,
            None,
            {1: queries_dim},
            {1: queries_dim},
            {1: queries_dim, 2: spans_dim},
        ),
        external_data=False,
    )
    import onnxruntime as ort
    session = ort.InferenceSession(str(args.out), providers=['CPUExecutionProvider'])
    got = session.run(None, {
        'token_states': token_states.numpy(),
        'text_mask': text_mask.numpy(),
        'query_states': query_states.numpy(),
        'query_mask': query_mask.numpy(),
        'indices': indices.numpy(),
    })[0]
    delta = float(abs(reference.numpy() - got).max())
    if delta > 1e-4:
        raise SystemExit(f'Export drifted from PyTorch by {delta}')
    # A shorter note padded to the fixed word axis must match an unpadded run.
    short = 10
    short_tokens = token_states[:, :short].contiguous()
    short_mask = torch.ones(1, short, dtype=torch.bool)
    short_indices = indices.clone()
    with torch.no_grad():
        short_ref = module(short_tokens, short_mask, query_states, query_mask, short_indices).numpy()
    padded_tokens = torch.zeros_like(token_states)
    padded_tokens[:, :short] = short_tokens
    padded_mask = torch.zeros(1, words, dtype=torch.bool)
    padded_mask[:, :short] = True
    padded = session.run(None, {
        'token_states': padded_tokens.numpy(),
        'text_mask': padded_mask.numpy(),
        'query_states': query_states.numpy(),
        'query_mask': query_mask.numpy(),
        'indices': short_indices.numpy(),
    })[0]
    pad_delta = float(abs(short_ref - padded).max())
    if pad_delta > 1e-3:
        raise SystemExit(f'Padding to 512 changed attribute logits by {pad_delta}')
    print(args.out, args.out.stat().st_size, 'max_abs', delta, 'pad_abs', pad_delta)


if __name__ == '__main__':
    main()
