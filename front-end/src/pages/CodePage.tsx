import { Code } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";

const CodePage = () => {
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
           <input className="col-span-12 lg:col-span-10 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent" placeholder="Simple toggle button using react hooks." />
           <Button className="col-span-12 lg:col-span-2 w-full" type="submit">
              Generate
           </Button>
        </div>
        <div className="space-y-4 mt-4">
          <div className="p-8 rounded-lg w-full flex items-center justify-center bg-muted">
            No code generated.
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodePage;
