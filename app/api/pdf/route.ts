import { Initializelangchain } from "@/app/utils/LangchainWebLoader";
import { NextRequest, NextResponse } from "next/server";



export async function POST(req:NextRequest,res:NextResponse){
    await Initializelangchain()

    return NextResponse.json({message:'success'},{status:200})
}