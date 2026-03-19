import { ArrowRight, Code, ImageIcon, MessageSquare, Music, VideoIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

const tools = [
  {
    label: "Conversation",
    icon: MessageSquare,
    color: "text-violet-500",
    bgColor: "bg-violet-500/10",
    href: "/conversation",
  },
  {
    label: "Music Generation",
    icon: Music,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    href: "/music",
  },
  {
    label: "Image Generation",
    icon: ImageIcon,
    color: "text-pink-700",
    bgColor: "bg-pink-700/10",
    href: "/image",
  },
  {
    label: "Video Generation",
    icon: VideoIcon,
    color: "text-orange-700",
    bgColor: "bg-orange-700/10",
    href: "/video",
  },
  {
    label: "Code Generation",
    icon: Code,
    color: "text-green-700",
    bgColor: "bg-green-700/10",
    href: "/code",
  },
];

const DashboardPage = () => {
  const navigate = useNavigate();

  return (
    <div className="pb-10">
      <div className="mb-8 space-y-4 pt-10">
        <h2 className="text-2xl md:text-4xl font-extrabold text-center text-slate-900">
          Explore the power of AI
        </h2>
        <p className="text-slate-500 font-light text-sm md:text-lg text-center">
          Chat with the smartest AI - Experience the power of AI
        </p>
      </div>
      <div className="px-4 md:px-20 lg:px-32 space-y-4">
        {tools.map((tool) => (
          <Card
            onClick={() => navigate(tool.href)}
            key={tool.href}
            className="p-4 border-slate-200 bg-white flex items-center justify-between hover:shadow-lg transition-all duration-300 cursor-pointer hover:-translate-y-1"
          >
            <div className="flex items-center gap-x-4">
              <div className={cn("p-2 w-fit rounded-lg", tool.bgColor)}>
                <tool.icon className={cn("w-8 h-8", tool.color)} />
              </div>
              <div className="font-bold text-slate-900">{tool.label}</div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-slate-900 transition" />
          </Card>
        ))}
      </div>
    </div>
  );
};

export default DashboardPage;
