import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import { OpenClawChat } from "@/components/chat/OpenClawChat";

export default function ChatPage() {
  return (
    <DashboardPageLayout
      title="Chat"
      signedOut={{
        message: "Sign in to view chat.",
        forceRedirectUrl: "/chat",
      }}
      contentClassName="p-0 overflow-hidden"
    >
      <OpenClawChat />
    </DashboardPageLayout>
  );
}
