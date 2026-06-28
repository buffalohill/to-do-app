-- Add user_id column linking todos to auth users
alter table todos
  add column user_id uuid references auth.users(id) default auth.uid();

-- Drop the temporary "allow all" policy
drop policy if exists "Allow all access for now" on todos;

-- Users can only read their own todos
create policy "Users can read own todos"
  on todos for select
  using (auth.uid() = user_id);

-- Users can create their own todos
create policy "Users can create own todos"
  on todos for insert
  with check (auth.uid() = user_id);

-- Users can update their own todos
create policy "Users can update own todos"
  on todos for update
  using (auth.uid() = user_id);

-- Users can delete their own todos
create policy "Users can delete own todos"
  on todos for delete
  using (auth.uid() = user_id);
