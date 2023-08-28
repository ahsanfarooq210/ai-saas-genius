'use client'

import React from "react";
import { Button } from "./ui/button";

type SubscriptionButtonPropTypes = {
  isPro: boolean;
};

const SubscriptionButton = ({ isPro=false }: SubscriptionButtonPropTypes) => {
  return (
    <Button>
        {isPro? "Manage Subscription":"Upgrade"}
        {!isPro}
    </Button>
  );
};

export default SubscriptionButton;
