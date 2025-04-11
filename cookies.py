import os
import sqlite3
import json

def dump_firefox_cookies():
  app_data = os.getenv('APPDATA')
  profile_dir = os.path.join(app_data, 'Mozilla', 'Firefox', 'Profiles')

  profiles = [f for f in os.listdir(profile_dir) if f.endswith('.default-release')]
  profile = profiles[0]

  cookies_db = os.path.join(profile_dir, profile, 'cookies.sqlite')
  conn = sqlite3.connect(cookies_db)
  cursor = conn.cursor()

  cursor.execute('SELECT host, name, value, expiry, isSecure FROM moz_cookies')
  cookies = cursor.fetchall()

  conn.close()
  cookies_by_host = {}
  for host, name, value, expiry, is_secure in cookies:
    if host not in cookies_by_host:
      cookies_by_host[host] = {}
    cookies_by_host[host][name] = (value, expiry, is_secure)

  # write youtube cookies to netscape format file
  youtube_cookie_rows = ['# Netscape HTTP Cookie File', '']
  for name, vals in cookies_by_host['.youtube.com'].items():
    value, expiry, is_secure = vals
    row = '\t'.join(('.youtube.com', 'TRUE', '/', 'TRUE' if is_secure else 'FALSE', str(expiry), name, value))
    youtube_cookie_rows.append(row)
  youtube_cookies = '\n'.join(youtube_cookie_rows)
  with open('youtube_cookies.txt', 'w') as fd:
    fd.write(youtube_cookies)

dump_firefox_cookies()
