import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import ChatWindow from "@/components/chat/ChatWindow";

export default function ChatPage() {
  return (
    <DashboardPageLayout
      signedOut={{
        message: "Sign in to view chat.",
        forceRedirectUrl: "/chat",
      }}
      title="OpenClaw Chat"
      description="Talk directly with your AI agent — responses stream in real time."
      stickyHeader
    >
      <ChatWindow />
    </DashboardPageLayout>
  );
}
