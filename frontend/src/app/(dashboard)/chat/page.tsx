import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import ChatWindow from "@/components/chat/ChatWindow";

export default function ChatPage() {
  return (
    <DashboardPageLayout 
      title="Chat"
      signedOut={{
        message: "Sign in to view chat.",
        forceRedirectUrl: "/chat",
      }}
    >
      <ChatWindow />
    </DashboardPageLayout>
  );
}
