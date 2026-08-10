import logging
import mimetypes
import uuid
from datetime import datetime
from typing import BinaryIO

from supabase import create_client, Client

from backend.config import settings

logger = logging.getLogger(__name__)


class SupabaseService:
    def __init__(self):
        self._client: Client | None = None
        self.bucket_name = settings.SUPABASE_STORAGE_BUCKET

    @property
    def client(self) -> Client:
        if self._client is None:
            self._client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_SERVICE_ROLE_KEY,
            )
        return self._client

    async def ensure_bucket_exists(self) -> bool:
        """Ensure the storage bucket exists."""
        try:
            buckets = self.client.storage.list_buckets()
            if not any(b.name == self.bucket_name for b in buckets):
                self.client.storage.create_bucket(
                    self.bucket_name,
                    options={"public": False, "file_size_limit": 52428800},  # 50MB
                )
                logger.info(f"Created storage bucket: {self.bucket_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to ensure bucket exists: {e}")
            return False

    def _get_content_type(self, filename: str) -> str:
        content_type, _ = mimetypes.guess_type(filename)
        return content_type or "application/octet-stream"

    def _generate_storage_path(self, project_id: str, filename: str) -> str:
        """Generate storage path: orbit-projects/{project_id}/{uuid}_{filename}"""
        unique_id = uuid.uuid4().hex[:8]
        ext = Path(filename).suffix
        base_name = Path(filename).stem
        safe_name = f"{base_name}_{unique_id}{ext}"
        return f"{project_id}/{safe_name}"

    async def upload_file(
        self,
        project_id: str,
        file: BinaryIO,
        filename: str,
        content_type: str | None = None,
    ) -> dict:
        """
        Upload file to Supabase Storage.
        
        Returns:
            Dict with path, public_url, size
        """
        await self.ensure_bucket_exists()
        
        storage_path = self._generate_storage_path(project_id, filename)
        ct = content_type or self._get_content_type(filename)
        
        file_content = file.read()
        file_size = len(file_content)
        
        try:
            result = self.client.storage.from_(self.bucket_name).upload(
                path=storage_path,
                file=file_content,
                file_options={"content-type": ct, "upsert": False},
            )
            
            if hasattr(result, 'error') and result.error:
                raise Exception(result.error.message)
            
            public_url = self.client.storage.from_(self.bucket_name).get_public_url(storage_path)
            
            logger.info(f"Uploaded file: {storage_path} ({file_size} bytes)")
            return {
                "path": storage_path,
                "public_url": public_url,
                "size": file_size,
                "filename": Path(storage_path).name,
            }
        except Exception as e:
            logger.error(f"Failed to upload file: {e}")
            raise

    async def upload_bytes(
        self,
        project_id: str,
        content: bytes,
        filename: str,
        content_type: str | None = None,
    ) -> dict:
        """Upload bytes to Supabase Storage."""
        import io
        return await self.upload_file(project_id, io.BytesIO(content), filename, content_type)

    async def download_file(self, storage_path: str) -> bytes:
        """Download file from Supabase Storage."""
        try:
            result = self.client.storage.from_(self.bucket_name).download(storage_path)
            return result
        except Exception as e:
            logger.error(f"Failed to download file {storage_path}: {e}")
            raise

    async def delete_file(self, storage_path: str) -> bool:
        """Delete file from Supabase Storage."""
        try:
            self.client.storage.from_(self.bucket_name).remove([storage_path])
            return True
        except Exception as e:
            logger.error(f"Failed to delete file {storage_path}: {e}")
            return False

    async def list_project_files(self, project_id: str) -> list[dict]:
        """List all files for a project."""
        try:
            files = self.client.storage.from_(self.bucket_name).list(project_id)
            return [
                {
                    "name": f["name"],
                    "size": f.get("metadata", {}).get("size", 0),
                    "created_at": f.get("created_at"),
                    "path": f"{project_id}/{f['name']}",
                }
                for f in files
            ]
        except Exception as e:
            logger.error(f"Failed to list files for project {project_id}: {e}")
            return []

    # Database operations for project_documents table
    async def save_document_record(
        self,
        project_id: str,
        filename: str,
        storage_path: str,
        file_size: int,
        mime_type: str,
        uploaded_by: str,
        document_type: str = "report",
    ) -> dict:
        """Save document metadata to project_documents table."""
        try:
            result = self.client.table("project_documents").insert({
                "project_id": project_id,
                "filename": filename,
                "storage_path": storage_path,
                "file_size": file_size,
                "mime_type": mime_type,
                "uploaded_by": uploaded_by,
                "document_type": document_type,
                "created_at": datetime.utcnow().isoformat(),
            }).execute()
            
            if result.data:
                return result.data[0]
            raise Exception("No data returned from insert")
        except Exception as e:
            logger.error(f"Failed to save document record: {e}")
            raise

    async def get_project_documents(self, project_id: str) -> list[dict]:
        """Get all documents for a project."""
        try:
            result = self.client.table("project_documents").select("*").eq("project_id", project_id).order("created_at", desc=True).execute()
            return result.data or []
        except Exception as e:
            logger.error(f"Failed to get project documents: {e}")
            return []

    async def delete_document_record(self, document_id: str) -> bool:
        """Delete document record from database."""
        try:
            self.client.table("project_documents").delete().eq("id", document_id).execute()
            return True
        except Exception as e:
            logger.error(f"Failed to delete document record: {e}")
            return False


from pathlib import Path
supabase_service = SupabaseService()