-- Create threads table
create table public.threads (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default 'New Discussion',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create messages table
create table public.messages (
  id uuid default gen_random_uuid() primary key,
  thread_id uuid references public.threads(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'agent')),
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.threads enable row level security;
alter table public.messages enable row level security;

-- Create policies for threads
create policy "Users can view their own threads"
  on public.threads for select
  using (auth.uid() = user_id);

create policy "Users can insert their own threads"
  on public.threads for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own threads"
  on public.threads for update
  using (auth.uid() = user_id);

create policy "Users can delete their own threads"
  on public.threads for delete
  using (auth.uid() = user_id);

-- Create policies for messages
create policy "Users can view messages in their threads"
  on public.messages for select
  using (auth.uid() = user_id);

create policy "Users can insert messages to their threads"
  on public.messages for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own messages"
  on public.messages for update
  using (auth.uid() = user_id);

create policy "Users can delete their own messages"
  on public.messages for delete
  using (auth.uid() = user_id);
