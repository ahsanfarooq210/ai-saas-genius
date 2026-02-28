import { ImageIcon } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";

const ImagePage = () => {
  return (
    <div>
      <Heading
        title="Image Generation"
        description="Turn your prompt into an image."
        icon={ImageIcon}
        iconColor="text-pink-700"
        bgColor="bg-pink-700/10"
      />
      <div className="px-4 lg:px-8">
        <div className="rounded-lg border w-full p-4 px-3 md:px-6 focus-within:shadow-sm grid grid-cols-12 gap-2">
           <input className="col-span-12 lg:col-span-6 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent" placeholder="A picture of a horse in Swiss alps" />
           <select className="col-span-12 lg:col-span-2 p-2 border rounded bg-background">
             <option value="1">1 Photo</option>
             <option value="2">2 Photos</option>
           </select>
           <select className="col-span-12 lg:col-span-2 p-2 border rounded bg-background">
             <option value="256x256">256x256</option>
             <option value="512x512">512x512</option>
             <option value="1024x1024">1024x1024</option>
           </select>
           <Button className="col-span-12 lg:col-span-2 w-full" type="submit">
              Generate
           </Button>
        </div>
        <div className="space-y-4 mt-4">
          <div className="p-8 rounded-lg w-full flex items-center justify-center bg-muted">
            No images generated.
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImagePage;
