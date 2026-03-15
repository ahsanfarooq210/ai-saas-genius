import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";
import { axiosClient } from "@/lib/axios";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const ConversationPage = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async () => {
    if (!input) return;

    try {
      setIsLoading(true);
      const userMessage: ChatMessage = { role: "user", content: input };
      const newMessages = [...messages, userMessage];
      setMessages(newMessages);
      setInput("");

      const response = await axiosClient.post("/conversation", {
        messages: newMessages,
      });

      setMessages((current) => [...current, response.data]);
    } catch (error) {
      console.error("[CONVERSATION_ERROR]", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <Heading
        title="Conversation"
        description="Our most advanced conversation model."
        icon={MessageSquare}
        iconColor="text-violet-500"
        bgColor="bg-violet-500/10"
      />
      <div className="px-4 lg:px-8">
        <div className="rounded-lg border w-full p-4 px-3 md:px-6 focus-within:shadow-sm grid grid-cols-12 gap-2">
           <input
             className="col-span-12 lg:col-span-10 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent"
             placeholder="How do I calculate the radius of a circle?"
             value={input}
             onChange={(e) => setInput(e.target.value)}
             disabled={isLoading}
             onKeyDown={(e) => {
               if (e.key === "Enter") {
                 onSubmit();
               }
             }}
           />
           <Button
             className="col-span-12 lg:col-span-2 w-full"
             onClick={onSubmit}
             disabled={isLoading || !input}
           >
              Generate
           </Button>
        </div>
        <div className="space-y-4 mt-4">
          {messages.length === 0 && !isLoading && (
            <div className="p-8 rounded-lg w-full flex items-center justify-center bg-muted">
              No conversation started.
            </div>
          )}
          <div className="flex flex-col-reverse gap-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`p-8 w-full flex items-start gap-x-8 rounded-lg ${
                  message.role === "user" ? "bg-white border border-black/10" : "bg-muted"
                }`}
              >
                <p className="text-sm">
                  {message.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConversationPage;
