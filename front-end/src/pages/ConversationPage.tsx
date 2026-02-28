import { MessageSquare } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";

const ConversationPage = () => {
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
           <input className="col-span-12 lg:col-span-10 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent" placeholder="How do I calculate the radius of a circle?" />
           <Button className="col-span-12 lg:col-span-2 w-full" type="submit">
              Generate
           </Button>
        </div>
        <div className="space-y-4 mt-4">
          <div className="p-8 rounded-lg w-full flex items-center justify-center bg-muted">
            No conversation started.
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConversationPage;
