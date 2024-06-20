"use client";

import React, { useEffect } from "react";
import { Crisp } from "crisp-sdk-web";

const CrispChat = () => {
  useEffect(() => {
    Crisp.configure("f0095937-8dc7-4e6f-be8b-1ad1e9517196");
  }, []);
  return null;
};

export default CrispChat;
