import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import ChatWindow from "@/components/chat/ChatWindow";

export default function ChatPage() {
  return (
    <DashboardPageLayout title="Chat">
      <ChatWindow />
    </DashboardPageLayout>
  );
}
