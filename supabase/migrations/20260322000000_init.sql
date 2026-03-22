-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uid UUID NOT NULL -- User ID from auth.users
);

-- Create histories table
CREATE TABLE IF NOT EXISTS histories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('communication', 'account_actions', 'group_update', 'client_response')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uid UUID NOT NULL -- User ID from auth.users
);

-- Enable Row Level Security
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE histories ENABLE ROW LEVEL SECURITY;

-- Policies for clients
CREATE POLICY "Users can view their own clients" ON clients
  FOR SELECT USING (auth.uid() = uid);

CREATE POLICY "Users can insert their own clients" ON clients
  FOR INSERT WITH CHECK (auth.uid() = uid);

CREATE POLICY "Users can update their own clients" ON clients
  FOR UPDATE USING (auth.uid() = uid);

CREATE POLICY "Users can delete their own clients" ON clients
  FOR DELETE USING (auth.uid() = uid);

-- Policies for histories
CREATE POLICY "Users can view their own histories" ON histories
  FOR SELECT USING (auth.uid() = uid);

CREATE POLICY "Users can insert their own histories" ON histories
  FOR INSERT WITH CHECK (auth.uid() = uid);

CREATE POLICY "Users can update their own histories" ON histories
  FOR UPDATE USING (auth.uid() = uid);

CREATE POLICY "Users can delete their own histories" ON histories
  FOR DELETE USING (auth.uid() = uid);
