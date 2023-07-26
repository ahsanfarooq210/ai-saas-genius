import Navbar from '@/components/Navbar'
import React from 'react'

type DashboardLayoutPropType={
    children: React.ReactNode,
}
const DashboardLayout = ({children}:DashboardLayoutPropType) => {
  return (
    <div className='h-full relative ' >
        <div className='hidden h-full md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 z-[80] bg-gray-900 ' >
            <div>
                Hellow sidebar
            </div>
        </div>
        <main className='md:pl-72' >
            <Navbar/>
            {children}
        </main>
    </div>
  )
}

export default DashboardLayout