alter table public.logbook_entries
  drop constraint if exists logbook_entries_flight_nature_check;

alter table public.logbook_entries
  add constraint logbook_entries_flight_nature_check
  check (flight_nature in (
    'STANDARD',
    'CAPTIVE',
    'TRAINING_BPL',
    'PROFICIENCY_CHECK_BPL',
    'SKILL_TEST',
    'COMMERCIAL_TRAINING',
    'COMMERCIAL_PROFICIENCY_CHECK',
    'INSTRUCTION'
  ));
