# Copies a migration into its block in supabase/repair.sql. The block starts
# after the banner naming the migration and ends at the next "-- ====" banner
# or the checklist. Usage: python3 scripts/sync-repair.py <migration file name>
import re, sys
name = sys.argv[1]
repair = open('supabase/repair.sql').read()
i = repair.index(f'({name})')
i = repair.index('\n', repair.index('\n', i) + 1) + 1
m = re.search(r'\n-- =+\n-- =+ [^\n]*\(\d+_[a-z_]+\.sql\)\n|\n-- -+ checklist -+', repair[i:])
repair = repair[:i] + open(f'supabase/migrations/{name}').read() + '\n' + repair[i + m.start():]
open('supabase/repair.sql', 'w').write(repair)
