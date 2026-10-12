"""Application-independent graphs, retaining native stable candidate deduplication.

The tensor interfaces follow Pastel-Cloud OÜ's Apache-2.0 GLiNER2.5 ONNX
interfaces (9f8173223d84bb65e6952d070137a990f93ef298). Unlike that export,
stable sorts are lowered to full-axis ONNX TopK; the native pool is not replaced.
"""
import contextlib
import json
from pathlib import Path
from unittest.mock import patch

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn
from torch.onnx import symbolic_helper

WORDS = 512
MAIN_INPUTS = ['input_ids', 'attention_mask', 'text_word_indices', 'text_word_mask',
               'query_marker_indices', 'query_marker_mask', 'cls_marker_indices',
               'cls_marker_mask', 'rel_marker_indices', 'rel_marker_mask']
MAIN_OUTPUTS = ['start_logits', 'end_logits', 'pair_indices', 'pair_logits', 'pair_valid',
                'cls_logits', 'text_states', 'query_states', 'rel_role_states',
                'candidate_states', 'null_logits']
RECORD_AXES = {'inst_states': {1: 'instances'}, 'inst_mask': {1: 'instances'},
               'field_query_states': {1: 'fields'},
               'field_cand_states': {1: 'fields', 2: 'candidates'},
               'field_cand_mask': {1: 'fields', 2: 'candidates'},
               'assign_logits': {1: 'instances', 2: 'fields', 3: 'candidates_with_null'},
               'object_logits': {1: 'instances'}, 'latent_logits': {1: 'instances'}}


def stable_sort(g, x, *args):
    dim = symbolic_helper._get_const(args[-2], 'i', 'dim')
    descending = symbolic_helper._get_const(args[-1], 'b', 'descending')
    size = g.op('Gather', g.op('Shape', x),
                g.op('Constant', value_t=torch.tensor([dim], dtype=torch.int64)), axis_i=0)
    # ONNX TopK specifies lower-index ordering for equal values, including int64 keys.
    return g.op('TopK', x, size, axis_i=dim, largest_i=int(descending), sorted_i=1, outputs=2)


@contextlib.contextmanager
def sort_symbols():
    torch.onnx.register_custom_op_symbolic('aten::sort', stable_sort, 18)
    torch.onnx.register_custom_op_symbolic('aten::argsort', lambda g, x, *a: stable_sort(g, x, *a)[1], 18)
    try:
        yield
    finally:
        torch.onnx.unregister_custom_op_symbolic('aten::sort', 18)
        torch.onnx.unregister_custom_op_symbolic('aten::argsort', 18)


def web_attention(block, states, mask):
    b, n, d = states.shape
    qkv = block.qkv_projection(block.norm(states)).reshape(b, n, 3, block.num_heads, block.head_dim)
    query, key, value = [qkv[:, :, i].permute(0, 2, 1, 3) for i in range(3)]
    scores = query @ key.transpose(-2, -1) * block.head_dim ** -0.5
    allowed = mask.reshape(b, 1, 1, n)
    positions = torch.arange(n, device=states.device)
    if block.window > 0:
        allowed = allowed & ((positions[:, None] - positions[None, :]).abs() <= block.window).reshape(1, 1, n, n)
    allowed = allowed | (positions[:, None] == positions[None, :]).reshape(1, 1, n, n)
    attended = (torch.softmax(scores.masked_fill(~allowed, -1e4), dim=-1) @ value).transpose(1, 2).reshape(b, n, d)
    return (states + block.dropout(block.output_projection(attended))) * mask.unsqueeze(-1).to(states.dtype)


def web_refinement(block, states):
    proj = block.input_projection(block.norm(states))
    half = proj.shape[-1] // 2
    update = proj[..., :half] * torch.nn.functional.silu(proj[..., half:])
    return states + block.dropout(block.output_projection(block.dropout(update)))


def prepare_web_attention(model):
    for block in model.boundary_head.boundary_encoder.attention_blocks:
        block.forward = lambda states, mask, block=block: web_attention(block, states, mask)
    for block in model.boundary_head.boundary_encoder.refinement_blocks:
        block.forward = lambda states, block=block: web_refinement(block, states)


class Main(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.encoder, self.head, self.classifier = model.encoder, model.boundary_head, model.classifier

    def forward(self, input_ids, attention_mask, text_word_indices, text_word_mask,
                query_marker_indices, query_marker_mask, cls_marker_indices, cls_marker_mask,
                rel_marker_indices, rel_marker_mask):
        hidden = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        def gather(indices, mask):
            values = hidden.gather(1, indices.clamp(0, hidden.shape[1]-1).unsqueeze(-1).expand(-1, -1, hidden.shape[-1]))
            return values * mask.unsqueeze(-1).to(values.dtype)
        text, query = gather(text_word_indices, text_word_mask), gather(query_marker_indices, query_marker_mask)
        out = self.head(text, text_word_mask.bool(), query, query_marker_mask.bool(), return_candidates=True)
        candidates = out.candidates
        null = out.null_logits if out.null_logits is not None else query_marker_mask * 0 - 1e4
        return (out.start_logits, out.end_logits, candidates.indices,
                candidates.pair_logits, candidates.valid_mask.to(torch.uint8),
                self.classifier(gather(cls_marker_indices, cls_marker_mask)).squeeze(-1) * cls_marker_mask,
                text, query, gather(rel_marker_indices, rel_marker_mask), candidates.candidate_states, null)


CLINICAL_INPUTS = MAIN_INPUTS[:6]
CLINICAL_OUTPUTS = ['start_logits', 'end_logits', 'pair_indices', 'pair_logits', 'pair_valid', 'text_states', 'query_states', 'null_logits']


class ClinicalMain(Main):
    """Expose only the encoder, span proposals and states used by v3 axes."""
    def forward(self, input_ids, attention_mask, text_word_indices, text_word_mask,
                query_marker_indices, query_marker_mask):
        dummy = query_marker_indices[:, :1] * 0
        mask = query_marker_mask[:, :1] * 0
        values = super().forward(input_ids, attention_mask, text_word_indices, text_word_mask,
                                 query_marker_indices, query_marker_mask, dummy, mask, dummy, mask)
        return tuple(values[MAIN_OUTPUTS.index(name)] for name in CLINICAL_OUTPUTS)


class Attributes(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.head = model.boundary_head

    def forward(self, text_states, text_word_mask, query_states, query_marker_mask, span_indices):
        return self.head.score_explicit_spans(text_states, text_word_mask > .5,
                                              query_states, query_marker_mask > .5, span_indices)


class Records(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.head = model.record_decoder

    def forward(self, inst_states, inst_mask, field_query_states, field_cand_states, field_cand_mask):
        h = self.head
        query = h.inst_proj(inst_states)[:, :, None, :] + h.field_proj(field_query_states)[:, None, :, :]
        null = torch.einsum('bnfd,d->bnf', query, h.null_embed)
        scores = torch.einsum('bnfd,bfcd->bnfc', query, h.cand_proj(field_cand_states))
        assign = torch.cat([null.unsqueeze(-1), scores.masked_fill(field_cand_mask[:, None, :, :] < .5, -1e4)], dim=-1)
        return (assign, h.object_head(inst_states).squeeze(-1).masked_fill(inst_mask < .5, -1e4),
                h.latent_seed_head(inst_states).squeeze(-1).masked_fill(inst_mask < .5, -1e4))


class Relations(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.scorer = model.relation_scorer

    def forward(self, text_states, rel_states, head_start, head_end, tail_start, tail_end, rel_index, pair_mask):
        s = self.scorer
        b, length, hidden = text_states.shape
        batch = torch.arange(b).unsqueeze(1).expand_as(head_start)
        def gather(pos):
            return text_states[batch, pos.clamp(0, length-1)]
        rel = rel_states[batch, rel_index]
        delta = (tail_start-head_start).to(text_states.dtype)
        # Tensor shape divisor stays dynamic; the older published head froze it to 48.
        distance = delta.abs() / torch._shape_as_tensor(text_states)[1].to(text_states.dtype)
        features = torch.cat([gather(head_start), gather(head_end-1), gather(tail_start),
                              gather(tail_end-1), rel, delta.sign().unsqueeze(-1), distance.unsqueeze(-1)], dim=-1)
        score = s.mlp(features).squeeze(-1)
        if s.use_biaffine_content:
            prefix = torch.cat([text_states.new_zeros(b, 1, hidden), text_states.float().cumsum(1).to(text_states.dtype)], dim=1)
            def pool(start, end):
                return (prefix[batch, end]-prefix[batch, start]) / (end-start).clamp_min(1).unsqueeze(-1).to(text_states.dtype)
            head, tail = s.head_content_projection(pool(head_start, head_end)), s.tail_content_projection(pool(tail_start, tail_end))
            score = score + (head * torch.sigmoid(s.relation_content_gate(rel)) * tail).sum(-1) / s.hidden_size ** .5
            score = score + s.content_linear(torch.cat([head, tail, rel], dim=-1)).squeeze(-1)
        return score * pair_mask


def session(path):
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 2
    opts.log_severity_level = 3
    return ort.InferenceSession(str(path), opts, providers=['CPUExecutionProvider'])


def tensor_json(tensor, *, expected=False):
    values = tensor.detach().cpu().numpy() if isinstance(tensor, torch.Tensor) else tensor
    row = {'dims': list(values.shape), 'data': values.reshape(-1).tolist()}
    if expected:
        row['tolerance'] = {'atol': 1e-4, 'rtol': 1e-4} if values.dtype.kind == 'f' else {'atol': 0, 'rtol': 0}
    else:
        row['type'] = 'int64' if values.dtype == np.int64 else 'float32'
    return row


def fixture(graph, feeds, outputs, token_rows=()):
    return {'graph': graph, 'origin': 'Merged PyTorch source tensors; export must pass before packaging',
            'tokenRows': list(token_rows), 'feeds': {k: tensor_json(v) for k, v in feeds.items()},
            'outputs': {k: tensor_json(v, expected=True) for k, v in outputs.items()}}


def compare(reference, actual):
    errors = {}
    for name, expected in reference.items():
        expected = expected.detach().numpy() if isinstance(expected, torch.Tensor) else expected
        got = actual[name]
        if got.shape != expected.shape or not np.all(np.isfinite(got)):
            raise ValueError(f'Invalid ONNX output shape/value: {name}')
        if not np.allclose(got, expected, atol=1e-4, rtol=1e-4):
            raise ValueError(f'ONNX/PyTorch mismatch: {name}, max_abs={np.max(np.abs(got-expected))}')
        errors[name] = float(np.max(np.abs(got.astype(np.float64)-expected.astype(np.float64))))
    return errors


def web_graph(path):
    graph = onnx.load(str(path))
    # Shape inference resolves CastLike targets rather than assuming float32.
    graph = onnx.shape_inference.infer_shapes(graph)
    types = {v.name: v.type.tensor_type.elem_type for v in [*graph.graph.input, *graph.graph.output, *graph.graph.value_info]}
    types.update({v.name: v.data_type for v in graph.graph.initializer})
    for node in graph.graph.node:
        if node.op_type == 'CastLike':
            target = types.get(node.input[1])
            if not target:
                raise ValueError('Unresolved CastLike target type')
            node.op_type = 'Cast'
            del node.input[1:]
            del node.attribute[:]
            node.attribute.extend([onnx.helper.make_attribute('to', target)])
        if node.domain not in ('', 'ai.onnx', 'ai.onnx.ml') or node.op_type in {'EyeLike', 'SplitToSequence', 'SequenceAt', 'Optional', 'OptionalGetElement'}:
            raise ValueError(f'Unsupported browser operation: {node.domain}:{node.op_type}')
    del graph.functions[:]
    keep = [v for v in graph.opset_import if v.domain in ('', 'ai.onnx', 'ai.onnx.ml')]
    del graph.opset_import[:]
    graph.opset_import.extend(keep)
    onnx.checker.check_model(graph)
    onnx.save(graph, str(path))


def export_graph(module, feeds, outputs, path, dynamic=None, dynamo=False, source_reference=None):
    module.eval()
    with torch.no_grad():
        values = module(*feeds.values())
    values = values if isinstance(values, tuple) else (values,)
    reference = dict(zip(outputs, values))
    if source_reference is not None:
        compare(source_reference, {k: v.detach().numpy() for k, v in reference.items()})
        reference = source_reference
    kwargs = {'dynamo': True, 'external_data': False} if dynamo else {'dynamic_axes': dynamic or {}, 'dynamo': False}
    with sort_symbols(), patch.object(torch, 'log1p', lambda x: torch.log(x+1)):
        torch.onnx.export(module, tuple(feeds.values()), str(path), input_names=list(feeds), output_names=outputs,
                          opset_version=18, **kwargs)
    web_graph(path)
    exported = session(path)
    actual = dict(zip(outputs, exported.run(None, {k: v.numpy() for k, v in feeds.items()})))
    errors = compare(reference, actual)
    return reference, errors


def head_feeds(hidden):
    rng = torch.Generator().manual_seed(431)
    def random(*shape):
        return torch.randn(*shape, generator=rng) * .1
    text = torch.zeros(1, WORDS, hidden)
    text[:, :10] = random(1, 10, hidden)
    mask = torch.zeros(1, WORDS)
    mask[:, :10] = 1
    spans = torch.zeros(1, 8, 16, 2, dtype=torch.int64)
    spans[..., 1] = 2
    return {
        'attributes': {'text_states': text, 'text_word_mask': mask, 'query_states': random(1, 8, hidden),
                       'query_marker_mask': torch.ones(1, 8), 'span_indices': spans},
        'records': {'inst_states': random(1, 2, hidden), 'inst_mask': torch.ones(1, 2),
                    'field_query_states': random(1, 2, hidden), 'field_cand_states': random(1, 2, 4, hidden),
                    'field_cand_mask': torch.ones(1, 2, 4)},
        'relations': {'text_states': random(1, 6, hidden), 'rel_states': random(1, 1, 2*hidden),
                      'head_start': torch.tensor([[0, 1]]), 'head_end': torch.tensor([[1, 2]]),
                      'tail_start': torch.tensor([[2, 4]]), 'tail_end': torch.tensor([[3, 5]]),
                      'rel_index': torch.zeros(1, 2, dtype=torch.int64), 'pair_mask': torch.ones(1, 2)},
    }


def export_heads(model, output, attribute_source, *, clinical=False):
    feeds = head_feeds(model.hidden_size)
    modules = {'attributes': Attributes(model), 'records': Records(model), 'relations': Relations(model)}
    names = {'attributes': ['attr_logits'], 'records': ['assign_logits', 'object_logits', 'latent_logits'], 'relations': ['rel_logits']}
    reports = {}
    for name, module in modules.items():
        if clinical and name != 'attributes':
            continue
        dynamic = {key: {1: 'axis_'+key} for key in feeds[name]}
        # Shared axes are intentionally named consistently for related inputs.
        dynamic.update({key: {1: 'words'} for key in ['text_states'] if key in feeds[name]})
        if name == 'records':
            dynamic = RECORD_AXES
        source_reference = {'attr_logits': attribute_source} if name=='attributes' else None
        if name=='records':
            f = feeds[name]
            with torch.no_grad():
                native = model.record_decoder._assign_logits(f['inst_states'][0], f['field_query_states'][0], list(f['field_cand_states'][0]))
                source_reference = {'assign_logits': torch.stack(native, 1).unsqueeze(0),
                                    'object_logits': model.record_decoder.object_head(f['inst_states']).squeeze(-1),
                                    'latent_logits': model.record_decoder.latent_seed_head(f['inst_states']).squeeze(-1)}
        if name=='relations':
            from gliner2.models.boundary.relations import RelationPairBatch
            f = feeds[name]
            pairs = RelationPairBatch(batch_index=torch.zeros(2, dtype=torch.long), relation_index=f['rel_index'][0],
                head_start=f['head_start'][0], head_end=f['head_end'][0], tail_start=f['tail_start'][0], tail_end=f['tail_end'][0],
                head_prob=torch.ones(2), tail_prob=torch.ones(2), pair_mask=torch.ones(2, dtype=torch.bool))
            with torch.no_grad():
                source_reference = {'rel_logits': model.relation_scorer(f['text_states'], f['rel_states'], None, pairs).unsqueeze(0)}
        reference, errors = export_graph(module, feeds[name], names[name], output/(name+'.onnx'), dynamic, dynamo=name=='attributes', source_reference=source_reference)
        (output/(name+'-reference.json')).write_text(json.dumps(fixture(name, feeds[name], reference), separators=(',', ':')))
        reports[name] = errors
        if name in ('records', 'relations'):
            # Exercise different dimensions against the original source scorer,
            # so a graph that accidentally freezes a fixture dimension fails.
            rng = torch.Generator().manual_seed(432)
            random = lambda *shape: torch.randn(*shape, generator=rng) * .1
            if name == 'records':
                extra = {'inst_states': random(1, 3, model.hidden_size), 'inst_mask': torch.ones(1, 3),
                         'field_query_states': random(1, 3, model.hidden_size),
                         'field_cand_states': random(1, 3, 9, model.hidden_size),
                         'field_cand_mask': torch.ones(1, 3, 9)}
                with torch.no_grad():
                    native = model.record_decoder._assign_logits(extra['inst_states'][0], extra['field_query_states'][0], list(extra['field_cand_states'][0]))
                    expected = {'assign_logits': torch.stack(native, 1).unsqueeze(0),
                                'object_logits': model.record_decoder.object_head(extra['inst_states']).squeeze(-1),
                                'latent_logits': model.record_decoder.latent_seed_head(extra['inst_states']).squeeze(-1)}
            else:
                extra = dict(feeds[name])
                extra['text_states'] = random(1, 96, model.hidden_size)
                extra['tail_start'] = torch.tensor([[70, 90]])
                extra['tail_end'] = torch.tensor([[72, 94]])
                pairs.tail_start, pairs.tail_end = extra['tail_start'][0], extra['tail_end'][0]
                with torch.no_grad():
                    expected = {'rel_logits': model.relation_scorer(extra['text_states'], extra['rel_states'], None, pairs).unsqueeze(0)}
            native_session = session(output/(name+'.onnx'))
            actual = dict(zip(names[name], native_session.run(None, {k: v.numpy() for k, v in extra.items()})))
            reports[name] = {'exportErrors': errors, 'variedShapeErrors': compare(expected, actual)}
            (output/(name+'-varied-reference.json')).write_text(json.dumps(fixture(name, extra, expected), separators=(',', ':')))
    return reports
