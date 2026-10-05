# Copies the latest migration into supabase/repair.sql (between its banner and the checklist).
import sys
mig_name = sys.argv[1]
repair = open('supabase/repair.sql').read()
mig = open(f'supabase/migrations/{mig_name}').read()
start_marker = f'({mig_name})'
i = repair.index(start_marker)
i = repair.index('\n', repair.index('\n', i) + 1) + 1  # after the closing ==== line
j = repair.index('\n-- ------------------------------------------------------------ checklist ----')
repair = repair[:i] + mig + '\n' + repair[j:]
open('supabase/repair.sql', 'w').write(repair)
