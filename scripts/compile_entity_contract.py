"""Compile an external model schema/settings into a declarative local contract.

This reads JSON only; it never imports a downloaded inference helper or a DTD.
Run using the locked tools/gliner-onnx environment.
"""
import argparse,json
from pathlib import Path
from gliner_onnx.entity_contract import contract_from_schema,verify_source_declaration
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--adapter',type=Path,required=True)
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args()
if args.out.exists():parser.error('Refusing to overwrite an existing contract')
contract=contract_from_schema(json.loads((args.adapter/'schema.json').read_text()),json.loads((args.adapter/'inference_settings.json').read_text()))
verify_source_declaration(args.adapter,contract)
with args.out.open('x') as file:json.dump(contract,file,ensure_ascii=False,indent=2)
print('Compiled and verified the complete external model contract; no private DTD or model code was imported.')
