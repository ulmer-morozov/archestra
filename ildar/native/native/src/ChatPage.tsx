import { ChatInput } from "./components/chat-input";

function ChatPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 space-y-2">
          {[...Array(40)].map(() => (
            <div className="bg-muted/50 h-10 rounded-xl" />
          ))}
      </div>
      <div className="p-4 min-h-min max-h-min">
        <ChatInput />
      </div>
    </div>
  );
}

export default ChatPage;
