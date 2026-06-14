from __future__ import annotations

from uuid import uuid4

from chatkit.store import NotFoundError, Store
from chatkit.types import Attachment, Page, ThreadItem, ThreadMetadata

from .client import AppApiChatClient
from .mapping import app_conversation_to_thread, app_conversations_to_page, app_messages_to_page


class CampusChatKitStore(Store[AppApiChatClient]):
    def generate_thread_id(self, context: AppApiChatClient) -> str:
        return f"conv_{uuid4().hex}"

    def generate_item_id(
        self,
        item_type: str,
        thread: ThreadMetadata,
        context: AppApiChatClient,
    ) -> str:
        return f"{item_type}_{uuid4().hex}"

    async def load_thread(self, thread_id: str, context: AppApiChatClient) -> ThreadMetadata:
        return app_conversation_to_thread(await context.get_conversation(thread_id))

    async def save_thread(self, thread: ThreadMetadata, context: AppApiChatClient) -> None:
        if thread.title:
            await context.rename_conversation(thread.id, thread.title)

    async def load_threads(
        self,
        limit: int,
        after: str | None,
        order: str,
        context: AppApiChatClient,
    ) -> Page[ThreadMetadata]:
        conversations = await context.list_conversations(limit=limit + 1)
        if order == "asc":
            conversations.reverse()
        return app_conversations_to_page(conversations, after=after, limit=limit)

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: AppApiChatClient,
    ) -> Page[ThreadItem]:
        conversation = await context.get_conversation(thread_id)
        messages = list(conversation.get("messages") or [])
        if order == "desc":
            messages.reverse()
        return app_messages_to_page(messages, after=after, limit=limit)

    async def add_thread_item(
        self,
        thread_id: str,
        item: ThreadItem,
        context: AppApiChatClient,
    ) -> None:
        # User and assistant item persistence is owned by app-api chat commands.
        return None

    async def save_item(self, thread_id: str, item: ThreadItem, context: AppApiChatClient) -> None:
        return None

    async def load_item(
        self, thread_id: str, item_id: str, context: AppApiChatClient
    ) -> ThreadItem:
        page = await self.load_thread_items(
            thread_id, after=None, limit=100, order="asc", context=context
        )
        for item in page.data:
            if item.id == item_id:
                return item
        raise NotFoundError(f"Thread item {item_id} was not found.")

    async def delete_thread(self, thread_id: str, context: AppApiChatClient) -> None:
        await context.delete_conversation(thread_id)

    async def delete_thread_item(
        self,
        thread_id: str,
        item_id: str,
        context: AppApiChatClient,
    ) -> None:
        await context.delete_trailing_messages(thread_id, item_id)

    async def save_attachment(self, attachment: Attachment, context: AppApiChatClient) -> None:
        raise NotImplementedError("ChatKit attachments are not enabled for campus Q&A.")

    async def load_attachment(self, attachment_id: str, context: AppApiChatClient) -> Attachment:
        raise NotImplementedError("ChatKit attachments are not enabled for campus Q&A.")

    async def delete_attachment(self, attachment_id: str, context: AppApiChatClient) -> None:
        raise NotImplementedError("ChatKit attachments are not enabled for campus Q&A.")
