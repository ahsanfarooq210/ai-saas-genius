import React from "react";
import { create } from "zustand";

type useProModalPropType = {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
};

const useProModel = create<useProModalPropType>((set) => {
  return {
    isOpen: false,
    onOpen: () => {
      set({ isOpen: true });
    },
    onClose: () => {
      set({ isOpen: false });
    },
  };
});

export default useProModel;
