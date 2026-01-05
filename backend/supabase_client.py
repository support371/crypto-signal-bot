"""
Supabase client setup
"""
import os
from supabase import create_client, Client
from unittest.mock import MagicMock

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

if url and key:
    supabase: Client = create_client(url, key)
else:
    print("WARNING: Supabase credentials not found. Using a mock client.")
    supabase: Client = MagicMock()
