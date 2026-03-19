import { useState } from "react";
import { Code } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";
import { axiosClient } from "../lib/axios";

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
      <div className="px-4 lg:px-8 pb-10">
        <div className="grid w-full grid-cols-12 gap-2 rounded-xl border border-border bg-card p-4 px-3 shadow-sm transition-shadow focus-within:shadow-md md:px-6">
          <input
            className="col-span-12 border-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-transparent lg:col-span-10"
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
            className="col-span-12 lg:col-span-2 w-full bg-green-600 hover:bg-green-700 text-white"
            onClick={onSubmit}
            disabled={isLoading || !input}
          >
            Generate
          </Button>
        </div>
        <div className="space-y-4 mt-8">
          {messages.length === 0 && !isLoading && (
            <div className="flex w-full items-center justify-center rounded-xl border border-border bg-card p-8 text-muted-foreground">
              No code generated.
            </div>
          )}
          <div className="flex flex-col-reverse gap-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`p-6 w-full flex items-start gap-x-8 rounded-xl ${
                  message.role === "user" ? "border border-border bg-muted text-foreground" : "border border-border bg-card text-card-foreground shadow-sm"
                }`}
              >
                <div className="text-sm overflow-hidden leading-7 w-full">
                  {message.role === "assistant" ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-border bg-muted p-4 text-xs text-foreground shadow-inner">
                      <code>{message.content}</code>
                    </pre>
                  ) : (
                    <p className="leading-relaxed">{message.content}</p>
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
