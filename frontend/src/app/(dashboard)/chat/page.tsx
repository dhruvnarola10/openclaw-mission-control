import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import { GatewayDirectChat } from "@/components/chat/GatewayDirectChat";

export default function ChatPage() {
  return (
    <DashboardPageLayout
      title="Chat"
      signedOut={{
        message: "Sign in to view chat.",
        forceRedirectUrl: "/chat",
      }}
    >
      <GatewayDirectChat />
    </DashboardPageLayout>
  );
}
