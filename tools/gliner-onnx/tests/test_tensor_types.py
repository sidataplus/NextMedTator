import unittest,numpy as np
from gliner_onnx.export import tensor_json
class TensorTypes(unittest.TestCase):
 def test_native_boolean_mask_serialization_keeps_onnx_input_type(self):
  row=tensor_json(np.array([[True,False]],dtype=np.bool_))
  self.assertEqual(row['type'],'bool');self.assertEqual(row['data'],[True,False])
 def test_float_masks_retain_legacy_float_interface(self):
  self.assertEqual(tensor_json(np.array([[1.,0.]],dtype=np.float32))['type'],'float32')
