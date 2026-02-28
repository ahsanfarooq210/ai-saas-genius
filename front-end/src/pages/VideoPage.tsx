import { VideoIcon } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";

const VideoPage = () => {
  return (
    <div>
      <Heading
        title="Video Generation"
        description="Turn your prompt into video."
        icon={VideoIcon}
        iconColor="text-orange-700"
        bgColor="bg-orange-700/10"
      />
      <div className="px-4 lg:px-8">
        <div className="rounded-lg border w-full p-4 px-3 md:px-6 focus-within:shadow-sm grid grid-cols-12 gap-2">
           <input className="col-span-12 lg:col-span-10 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent" placeholder="Clown fish swimming around a coral reef" />
           <Button className="col-span-12 lg:col-span-2 w-full" type="submit">
              Generate
           </Button>
        </div>
        <div className="space-y-4 mt-4">
          <div className="p-8 rounded-lg w-full flex items-center justify-center bg-muted">
            No video generated.
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPage;
