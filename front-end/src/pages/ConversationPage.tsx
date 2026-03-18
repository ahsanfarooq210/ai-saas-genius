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
      <div className="px-4 lg:px-8 pb-10">
        <div className="rounded-xl border border-slate-200 bg-white w-full p-4 px-3 md:px-6 shadow-sm focus-within:shadow-md transition-shadow grid grid-cols-12 gap-2">
           <input
             className="col-span-12 lg:col-span-10 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent text-slate-900 placeholder:text-slate-500"
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
             className="col-span-12 lg:col-span-2 w-full bg-violet-600 hover:bg-violet-700 text-white"
             onClick={onSubmit}
             disabled={isLoading || !input}
           >
              Generate
           </Button>
        </div>
        <div className="space-y-4 mt-8">
          {messages.length === 0 && !isLoading && (
            <div className="p-8 rounded-xl w-full flex items-center justify-center bg-white border border-slate-100 text-slate-500">
              No conversation started.
            </div>
          )}
          <div className="flex flex-col-reverse gap-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`p-6 w-full flex items-start gap-x-8 rounded-xl ${
                  message.role === "user" ? "bg-slate-100 border border-slate-200 text-slate-800" : "bg-white border border-slate-200 shadow-sm text-slate-900"
                }`}
              >
                <p className="text-sm leading-relaxed">
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
