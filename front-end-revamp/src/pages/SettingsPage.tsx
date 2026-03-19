import { Settings } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";

const SettingsPage = () => {
  return (
    <div>
      <Heading
        title="Settings"
        description="Manage account and subscription settings."
        icon={Settings}
        iconColor="text-primary"
        bgColor="bg-primary/10"
      />
      <div className="space-y-4 px-4 lg:px-8">
        <div className="text-sm text-muted-foreground">
          You are currently on a free plan.
        </div>
        <Button variant="default">
          Manage Subscription
        </Button>
      </div>
    </div>
  );
};

export default SettingsPage;
