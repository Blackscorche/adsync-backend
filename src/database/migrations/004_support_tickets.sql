-- Migration: Support Ticket System
-- Allows owners to request screens, content changes, and get support

-- Create ticket categories enum
DO $$ BEGIN
    CREATE TYPE ticket_category AS ENUM (
        'screen_request',      -- Request new screens
        'content_request',     -- Request content to be played
        'technical_issue',     -- Technical problems
        'billing_inquiry',     -- Billing questions
        'content_removal',     -- Request to remove content
        'schedule_change',     -- Request schedule changes
        'general_inquiry'      -- General questions
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create ticket priority enum
DO $$ BEGIN
    CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create ticket status enum
DO $$ BEGIN
    CREATE TYPE ticket_status AS ENUM (
        'open',          -- Just created
        'in_progress',   -- Being worked on
        'waiting_owner', -- Waiting for owner response
        'waiting_admin', -- Waiting for admin response
        'resolved',      -- Issue resolved
        'closed'         -- Ticket closed
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create support_tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    ticket_number VARCHAR(20) UNIQUE NOT NULL,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    assigned_to INTEGER REFERENCES users(id),
    category ticket_category NOT NULL,
    priority ticket_priority DEFAULT 'medium',
    status ticket_status DEFAULT 'open',
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,

    -- For screen requests
    screen_size VARCHAR(10),
    screen_quantity INTEGER,
    installation_address TEXT,
    preferred_installation_date DATE,

    -- For content requests
    content_type VARCHAR(50),
    play_duration VARCHAR(100),
    target_screens TEXT[],
    start_date DATE,
    end_date DATE,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    closed_at TIMESTAMP,
    resolution_notes TEXT,
    internal_notes TEXT
);

-- Create ticket_comments table for conversation
CREATE TABLE IF NOT EXISTS ticket_comments (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    comment TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create ticket_attachments table
CREATE TABLE IF NOT EXISTS ticket_attachments (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES ticket_comments(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_url VARCHAR(500) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tickets_shop_id ON support_tickets(shop_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON support_tickets(category);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON support_tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON support_tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket_id ON ticket_attachments(ticket_id);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_ticket_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_support_tickets_updated_at
BEFORE UPDATE ON support_tickets
FOR EACH ROW
EXECUTE FUNCTION update_ticket_updated_at();

-- Add comments
COMMENT ON TABLE support_tickets IS 'Support ticket system for owner requests and issues';
COMMENT ON COLUMN support_tickets.category IS 'Type of support request';
COMMENT ON COLUMN support_tickets.priority IS 'Urgency level of the ticket';
COMMENT ON COLUMN support_tickets.status IS 'Current status of the ticket';