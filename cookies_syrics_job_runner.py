import os
import json

def write_local_sp_dc():
  app_data = os.getenv('APPDATA')
  syrics_config_path = os.path.join(app_data, 'syrics', 'config.json')
  with open(syrics_config_path, 'r') as fd:
    syrics_config = json.load(fd)
  with open('spotify_sp_dc_cookies.txt', 'r') as fd:
    sp_dc = fd.readline()
  if not sp_dc:
    print('no local sp_dc found in spotify_sp_dc_cookies.txt!')
    raise
  syrics_config['sp_dc'] = sp_dc
  with open(syrics_config_path, 'w') as fd:
    json.dump(syrics_config, fd, indent=4)

  print(f'wrote updated sp_dc from host to {syrics_config_path}')

write_local_sp_dc()
