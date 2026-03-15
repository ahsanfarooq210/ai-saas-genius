import { useState } from "react";
import { Code } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";
import { axiosClient } from "@/lib/axios";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const CodePage = () => {
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

      const response = await axiosClient.post("/code", {
        messages: newMessages,
      });

      setMessages((current) => [...current, response.data]);
    } catch (error) {
      console.error("[CODE_ERROR]", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <Heading
        title="Code Generation"
        description="Generate code using descriptive text."
        icon={Code}
        iconColor="text-green-700"
        bgColor="bg-green-700/10"
      />
      <div className="px-4 lg:px-8">
        <div className="rounded-lg border w-full p-4 px-3 md:px-6 focus-within:shadow-sm grid grid-cols-12 gap-2">
           <input
             className="col-span-12 lg:col-span-10 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent"
             placeholder="Simple toggle button using react hooks."
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
              No code generated.
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
                <div className="text-sm overflow-hidden leading-7">
                  {message.role === "assistant" ? (
                    <pre className="bg-black/10 p-2 rounded-lg break-words overflow-x-auto whitespace-pre-wrap">
                      <code>{message.content}</code>
                    </pre>
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodePage;
