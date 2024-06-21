import { useGetUserDocs } from "@/hooks/useGetUserDocs";
import React from "react";
import { Card, CardHeader, CardTitle } from "../ui/card";
import { Book } from "lucide-react";

const UserDocList = () => {
  const { userDocs } = useGetUserDocs();
  return (
    <div className="w-full h-max flex flex-row flex-wrap gap-4">
      {userDocs?.map((doc) => {
        return (
          <div key={doc.id}>
            <Card className=" shadow-md hover:shadow-2xl transition-all hover:delay-100 ">
              <CardHeader className="text-center ">
                <CardTitle className="flex flex-row items-center gap-3">
                  <Book className="text-red-500" />
                  <p>{doc.documentName}</p>
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        );
      })}
    </div>
  );
};

export default UserDocList;
