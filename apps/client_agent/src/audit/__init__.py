"""
Audit Package.
"""
from src.audit.logger import record_audit_event, fetch_audit_logs

__all__ = ["record_audit_event", "fetch_audit_logs"]
