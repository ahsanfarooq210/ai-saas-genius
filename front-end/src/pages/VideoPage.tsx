import { useState } from "react";
import { VideoIcon } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";
import { axiosClient } from "@/lib/axios";

const VideoPage = () => {
  const [prompt, setPrompt] = useState("");
  const [video, setVideo] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async () => {
    if (!prompt) return;

    try {
      setVideo(undefined);
      setIsLoading(true);

      const response = await axiosClient.post("/video", {
        prompt,
      });

      setVideo(response.data[0]);
    } catch (error) {
      console.error("[VIDEO_ERROR]", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <Heading
        title="Video Generation"
        description="Turn your prompt into video."
        icon={VideoIcon}
        iconColor="text-orange-700"
        bgColor="bg-orange-700/10"
      />
      <div className="px-4 lg:px-8 pb-10">
        <div className="rounded-xl border border-slate-200 bg-white w-full p-4 px-3 md:px-6 shadow-sm focus-within:shadow-md transition-shadow grid grid-cols-12 gap-2">
           <input
             className="col-span-12 lg:col-span-10 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent text-slate-900 placeholder:text-slate-500"
             placeholder="Clown fish swimming around a coral reef"
             value={prompt}
             onChange={(e) => setPrompt(e.target.value)}
             disabled={isLoading}
             onKeyDown={(e) => {
               if (e.key === "Enter") {
                 onSubmit();
               }
             }}
           />
           <Button
             className="col-span-12 lg:col-span-2 w-full bg-orange-600 hover:bg-orange-700 text-white"
             onClick={onSubmit}
             disabled={isLoading || !prompt}
           >
              Generate
           </Button>
        </div>
        <div className="space-y-4 mt-8">
          {!video && !isLoading && (
            <div className="p-8 rounded-xl w-full flex items-center justify-center bg-white border border-slate-100 text-slate-500">
              No video generated.
            </div>
          )}
          {video && (
            <video controls className="w-full aspect-video mt-8 rounded-xl border shadow-sm bg-black">
              <source src={video} />
            </video>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoPage;
