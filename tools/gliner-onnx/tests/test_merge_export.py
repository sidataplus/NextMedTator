import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import torch
from peft import LoraConfig, get_peft_model
from transformers import PretrainedConfig

from gliner_onnx.cli import merge_adapter
from gliner_onnx.export import session, sort_symbols, Records, RECORD_AXES, export_graph, compare


class Encoder(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.embedding = torch.nn.Embedding(128, 8)
        self.query_proj = torch.nn.Linear(8, 8)

    def forward(self, input_ids, attention_mask):
        return SimpleNamespace(last_hidden_state=self.query_proj(self.embedding(input_ids)))


class Extractor(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder = Encoder()
        self.classifier = torch.nn.Linear(8, 1)
        self.config = PretrainedConfig()
        self.name_or_path = 'synthetic-test-base'


class MergeExport(unittest.TestCase):
    def test_record_export_accepts_other_instance_field_and_candidate_counts(self):
        from gliner2.models.boundary.records import RecordHead
        torch.manual_seed(431)
        head = RecordHead(hidden_size=8, record_dim=4, instance_queries=3).eval()
        def feeds(instances, fields, candidates):
            return {'inst_states': torch.randn(1, instances, 8), 'inst_mask': torch.ones(1, instances),
                    'field_query_states': torch.randn(1, fields, 8),
                    'field_cand_states': torch.randn(1, fields, candidates, 8),
                    'field_cand_mask': torch.ones(1, fields, candidates)}
        names = ['assign_logits', 'object_logits', 'latent_logits']
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'records.onnx'
            export_graph(Records(SimpleNamespace(record_decoder=head)), feeds(2, 2, 4), names, path, RECORD_AXES)
            native = session(path)
            for shape in [(1, 1, 1), (3, 3, 9), (2, 2, 192)]:
                f = feeds(*shape)
                with torch.no_grad():
                    source = head._assign_logits(f['inst_states'][0], f['field_query_states'][0], list(f['field_cand_states'][0]))
                actual = dict(zip(names, native.run(None, {k:v.numpy() for k,v in f.items()})))
                compare({'assign_logits': torch.stack(source, 1).unsqueeze(0)}, actual)

    def test_different_ranks_and_scaling_merge_actual_adapter_weights(self):
        for rank, rslora, dora in [(2, False, False), (4, True, False), (3, False, True)]:
            with self.subTest(rank=rank), tempfile.TemporaryDirectory() as directory:
                torch.manual_seed(431)
                base = Extractor()
                base.name_or_path = directory
                base.config.save_pretrained(directory)
                trained = get_peft_model(base, LoraConfig(r=rank, lora_alpha=rank*2,
                                                               target_modules=['query_proj'], use_rslora=rslora, use_dora=dora))
                with torch.no_grad():
                    trained.base_model.model.encoder.query_proj.lora_B['default'].weight.fill_(.05)
                trained.save_pretrained(directory)
                torch.manual_seed(431)
                fresh = Extractor()
                fresh.name_or_path = directory
                merged, report = merge_adapter(fresh, Path(directory))
                self.assertGreater(report['baseToAdapterEncoderMaxAbsoluteChange'], 0)
                self.assertLess(report['activeToMergedMaxAbsoluteError'], 1e-4)
                self.assertEqual(report['trainedHeads'], 'unchanged')
                self.assertFalse(any('lora_' in key for key in merged.state_dict()))

    def test_head_only_adapter_keeps_its_effect_and_trained_head_fingerprint(self):
        with tempfile.TemporaryDirectory() as directory:
            torch.manual_seed(431)
            base = Extractor()
            base.name_or_path = directory
            base.config.save_pretrained(directory)
            trained = get_peft_model(base, LoraConfig(r=2, lora_alpha=4, target_modules=['classifier']))
            with torch.no_grad():
                trained.base_model.model.classifier.lora_B['default'].weight.fill_(.05)
                probe = torch.randn(3, 8)
                expected = trained.classifier(probe).clone()
            trained.save_pretrained(directory)
            torch.manual_seed(431)
            fresh = Extractor()
            fresh.name_or_path = directory
            merged, report = merge_adapter(fresh, Path(directory))
            self.assertEqual(len(report['trainedHeads']), 64)
            self.assertEqual(report['baseToAdapterEncoderMaxAbsoluteChange'], 0)
            torch.testing.assert_close(merged.classifier(probe), expected, atol=1e-4, rtol=1e-4)

    def test_stable_sort_keeps_native_tie_order_across_dynamic_lengths(self):
        class Sort(torch.nn.Module):
            def forward(self, values):
                return torch.argsort(values, stable=True, descending=True), torch.argsort(values, stable=True)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'sort.onnx'
            sample = torch.tensor([[2., 3., 3., 1., 2.]])
            with sort_symbols():
                torch.onnx.export(Sort(), (sample,), str(path), input_names=['values'], output_names=['descending', 'ascending'],
                                  opset_version=18, dynamic_axes={'values': {1: 'length'}, 'descending': {1: 'length'}, 'ascending': {1: 'length'}})
            native = session(path)
            for values in [sample, torch.zeros(1, 3), torch.tensor([[1., 1., -3., -3., 2., 2., 0.]])]:
                expected = Sort()(values)
                actual = native.run(None, {'values': values.numpy()})
                for a, b in zip(actual, expected):
                    np.testing.assert_array_equal(a, b.numpy())


if __name__ == '__main__':
    unittest.main()
