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
  role text not null check (role in ('user', 'assistant', 'agent')),
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Attachment metadata only (file content stays ephemeral/session-local for now)
create table public.message_attachments (
  id uuid default gen_random_uuid() primary key,
  thread_id uuid references public.threads(id) on delete cascade not null,
  message_id uuid references public.messages(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  original_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Real-run UI artifact payloads (docs/files/preview cache) for durable reloads
create table public.message_artifacts (
  id uuid default gen_random_uuid() primary key,
  thread_id uuid references public.threads(id) on delete cascade not null,
  message_id uuid references public.messages(id) on delete cascade not null unique,
  user_id uuid references auth.users(id) on delete cascade not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_artifacts enable row level security;

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

-- Create policies for attachment metadata
create policy "Users can view attachments in their threads"
  on public.message_attachments for select
  using (auth.uid() = user_id);

create policy "Users can insert attachments to their threads"
  on public.message_attachments for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own attachments"
  on public.message_attachments for update
  using (auth.uid() = user_id);

create policy "Users can delete their own attachments"
  on public.message_attachments for delete
  using (auth.uid() = user_id);

-- Create policies for real-run artifact payloads
create policy "Users can view artifacts in their threads"
  on public.message_artifacts for select
  using (auth.uid() = user_id);

create policy "Users can insert artifacts to their threads"
  on public.message_artifacts for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own artifacts"
  on public.message_artifacts for update
  using (auth.uid() = user_id);

create policy "Users can delete their own artifacts"
  on public.message_artifacts for delete
  using (auth.uid() = user_id);
