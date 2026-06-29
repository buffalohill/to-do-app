-- Add sort_order column (nullable initially for backfill)
alter table todos
  add column sort_order integer;

-- Backfill per user, preserving created_at order
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at asc, id asc
    ) - 1 as rn
  from todos
)
update todos t
set sort_order = r.rn
from ranked r
where t.id = r.id;

-- Enforce NOT NULL
alter table todos
  alter column sort_order set not null;

-- Index for efficient ordered reads per user
create index todos_user_id_sort_order_idx on todos (user_id, sort_order);
