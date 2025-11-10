"use client";

import { useState } from "react";
import { PlusIcon, MinusIcon } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface ExpandableSectionProps {
  title: string;
  logo?: string;
  logoAlt?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  className?: string;
}

export function ExpandableSection({
  title,
  logo,
  logoAlt,
  children,
  defaultExpanded = false,
  className
}: ExpandableSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className={cn("", className)}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {logo && (
            <div className="w-full h-full flex items-center justify-center">
              <Image
                src={logo}
                alt={logoAlt || title}
                width={100}
                height={48}
                className="object-contain"
              />
            </div>
          )}
        </div>
        {isExpanded ? (
          <MinusIcon className="w-5 h-5 text-gray-500" />
        ) : (
          <PlusIcon className="w-5 h-5 text-gray-500" />
        )}
      </button>
      
      {/* Light grey border below title */}
      <div className="border-b border-gray-200"></div>
      
      {isExpanded && (
        <div className="pb-4">
          <div>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
