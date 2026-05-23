#!/usr/bin/env python3
"""Standalone migration: add `extra_fields TEXT NOT NULL DEFAULT '{}'` column
to todos, schedules, notifications (standalone + per-user tables).

Usage:
    python scripts/migrate_extra_fields.py [db_path]

Default db_path: db/amtodo.sqlite3
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

# Table name prefixes that should carry extra_fields.
ENTITY_PREFIXES = ("todos", "schedules", "notifications")

SQL = "ALTER TABLE {table} ADD COLUMN extra_fields TEXT NOT NULL DEFAULT '{{}}'"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Add extra_fields column to todo/schedule/notification tables."
    )
    parser.add_argument(
        "db_path",
        nargs="?",
        default="db/amtodo.sqlite3",
        help="Path to the SQLite database (default: db/amtodo.sqlite3)",
    )
    args = parser.parse_args()

    db = Path(args.db_path)
    if not db.exists():
        print(f"Error: database not found at {db}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(str(db))
    cur = conn.cursor()

    # Gather user IDs from _users table.
    try:
        cur.execute("SELECT id FROM _users")
        user_ids: list[int] = [row[0] for row in cur.fetchall()]
    except sqlite3.OperationalError:
        print("Warning: _users table not found; skipping per-user tables.")
        user_ids = []

    migrated: list[str] = []
    skipped: list[str] = []

    # Build the full list of table names to migrate.
    tables: list[str] = []
    for prefix in ENTITY_PREFIXES:
        tables.append(prefix)                       # standalone
        for uid in user_ids:
            tables.append(f"{prefix}_{uid}")         # per-user

    for table in tables:
        try:
            cur.execute(SQL.format(table=table))
            migrated.append(table)
        except sqlite3.OperationalError as exc:
            # "duplicate column name" means column already exists – skip silently.
            if "duplicate column" in str(exc).lower():
                skipped.append(f"{table} (already migrated)")
            else:
                skipped.append(f"{table} ({exc})")

    conn.commit()
    conn.close()

    # Report.
    print(f"Database: {db}")
    print(f"Users found in _users: {len(user_ids)}")
    print(f"Tables migrated: {len(migrated)}")
    for t in migrated:
        print(f"  + {t}")
    if skipped:
        print(f"Tables skipped: {len(skipped)}")
        for t in skipped:
            print(f"  - {t}")
    print("Done.")


if __name__ == "__main__":
    main()
