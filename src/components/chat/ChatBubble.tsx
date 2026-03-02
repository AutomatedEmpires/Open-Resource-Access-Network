import Link from 'next/link';
import { MessageCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';

type ChatBubbleProps = {
  href?: string;
  className?: string;
};

export function ChatBubble({ href = '/chat', className }: ChatBubbleProps) {
  return (
    <div className={className ?? 'fixed bottom-6 right-6 z-50'}>
      <Button asChild size="icon" className="min-w-[44px] min-h-[44px] h-11 w-11" aria-label="Open chat">
        <Link href={href}>
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
