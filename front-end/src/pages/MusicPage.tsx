import { useState } from "react";
import { Music } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";
import { axiosClient } from "@/lib/axios";

const MusicPage = () => {
  const [prompt, setPrompt] = useState("");
  const [music, setMusic] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async () => {
    if (!prompt) return;

    try {
      setMusic(undefined);
      setIsLoading(true);

      const response = await axiosClient.post("/music", {
        prompt,
      });

      setMusic(response.data.audio);
    } catch (error) {
      console.error("[MUSIC_ERROR]", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <Heading
        title="Music Generation"
        description="Turn your prompt into music."
        icon={Music}
        iconColor="text-emerald-500"
        bgColor="bg-emerald-500/10"
      />
      <div className="px-4 lg:px-8 pb-10">
        <div className="rounded-xl border border-slate-200 bg-white w-full p-4 px-3 md:px-6 shadow-sm focus-within:shadow-md transition-shadow grid grid-cols-12 gap-2">
           <input
             className="col-span-12 lg:col-span-10 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent text-slate-900 placeholder:text-slate-500"
             placeholder="Piano solo"
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
             className="col-span-12 lg:col-span-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white"
             onClick={onSubmit}
             disabled={isLoading || !prompt}
           >
              Generate
           </Button>
        </div>
        <div className="space-y-4 mt-8">
          {!music && !isLoading && (
            <div className="p-8 rounded-xl w-full flex items-center justify-center bg-white border border-slate-100 text-slate-500">
              No music generated.
            </div>
          )}
          {music && (
            <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm mt-8">
              <audio controls className="w-full">
                <source src={music} />
              </audio>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MusicPage;
