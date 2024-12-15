-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT,
    "bridgeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "threadId" TEXT,
    "replyToId" TEXT,
    "attachments" JSONB,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_platform_channelId_key" ON "Channel"("platform", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_platform_platformId_key" ON "Message"("platform", "platformId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
