
// src/components/lessons/LessonView.tsx
"use client";

import React, { useEffect, useState, useMemo, Fragment, useCallback } from 'react';
import Image from 'next/image';
import type { Lesson, Achievement, UserProfile } from '@/lib/types'; // UserProfile adicionado
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, CheckCircle, Clock, Loader2, FileText, Info } from 'lucide-react';
import Link from 'next/link';
import { InteractiveWordChoice } from './InteractiveWordChoice';
import { InteractiveFillInBlank } from './InteractiveFillInBlank';
import { Separator } from '../ui/separator';
import { cn, shuffleArray } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { markLessonAsCompleted as markLessonCompletedAction } from '@/app/actions/userProgressActions';
import { playSound } from '@/lib/sounds';
import { useRouter } from 'next/navigation';
import { LOCAL_STORAGE_KEYS } from '@/constants';
import { mockLessons as allMockLessons, mockRoadmapData, mockAchievements } from '@/lib/mockData';

interface LessonViewProps {
  lesson: Lesson;
}

const wordChoiceRegexSource = "INTERACTIVE_WORD_CHOICE:\\s*OPTIONS=\\[(.*?)\\]";
const fillBlankRegexSource = "INTERACTIVE_FILL_IN_BLANK:\\s*\\[(.*?)\\]";
const combinedRegex = new RegExp(
  `<!--\\s*(${wordChoiceRegexSource})\\s*-->|<!--\\s*(${fillBlankRegexSource})\\s*-->`,
  "g"
);
const boldRegexGlobal = /\*\*(.*?)\*\*/g;

const renderTextWithBold = (text: string, baseKey: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  boldRegexGlobal.lastIndex = 0; 

  while ((match = boldRegexGlobal.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    parts.push(<strong key={`${baseKey}-bold-${match.index}`}>{match[1]}</strong>);
    lastIndex = boldRegexGlobal.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  return parts;
};

const renderContentWithParagraphs = (elements: (string | JSX.Element)[], baseKey: string): JSX.Element[] => {
  const outputParagraphs: JSX.Element[] = [];
  let currentParagraphChildren: React.ReactNode[] = [];
  let paragraphKeyCounter = 0;

  const finalizeParagraph = () => {
    if (currentParagraphChildren.length > 0) {
      outputParagraphs.push(
        <p key={`${baseKey}-p-${paragraphKeyCounter++}`} className="mb-4 last:mb-0">
          {currentParagraphChildren}
        </p>
      );
      currentParagraphChildren = [];
    }
  };

  elements.forEach((element, elementIdx) => {
    if (typeof element === 'string') {
      const textLines = element.split(/(\n|\\n)/g); 

      textLines.forEach((line, lineIdx) => {
        if (line === '\n' || line === '\\n') {
          finalizeParagraph();
        } else if (line.trim() !== '') {
          currentParagraphChildren.push(
            ...renderTextWithBold(line, `${baseKey}-txt-${elementIdx}-${lineIdx}`)
          );
        }
      });
    } else {
      currentParagraphChildren.push(React.cloneElement(element as React.ReactElement, { key: `${baseKey}-jsx-${elementIdx}` }));
    }
  });

  finalizeParagraph(); 

  if (outputParagraphs.length === 0 && elements.some(el => (typeof el === 'string' && el.trim() !== '') || React.isValidElement(el))) {
    return [
      <p key={`${baseKey}-p-single`} className="mb-4 last:mb-0">
        {elements.map((el, i) => 
          typeof el === 'string' 
            ? <Fragment key={`${baseKey}-sfrag-${i}`}>{renderTextWithBold(el, `${baseKey}-sfrag-txt-${i}`)}</Fragment> 
            : React.cloneElement(el as React.ReactElement, { key: `${baseKey}-sfrag-jsx-${i}` })
        )}
      </p>
    ];
  }
  return outputParagraphs;
};


export function LessonView({ lesson }: LessonViewProps) {
  const { userProfile, loading: authLoading, updateUserProfile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [isMarkingComplete, setIsMarkingComplete] = useState(false);
  
  const [prevLesson, setPrevLesson] = useState<Lesson | null>(null);
  const [nextLesson, setNextLesson] = useState<Lesson | null>(null);

  const [totalInteractiveElements, setTotalInteractiveElements] = useState(0);
  const [completedInteractionIds, setCompletedInteractionIds] = useState<Set<string>>(new Set());

  const handleInteractionCorrect = useCallback((interactionId: string) => {
    setCompletedInteractionIds(prev => {
      const newSet = new Set(prev);
      newSet.add(interactionId);
      if (typeof window !== 'undefined' && lesson) {
          const currentLessonInteractionsKey = `${LOCAL_STORAGE_KEYS.GUEST_COMPLETED_LESSONS}_interactions_${lesson.id}`;
          localStorage.setItem(currentLessonInteractionsKey, JSON.stringify(Array.from(newSet)));
      }
      return newSet;
    });
  }, [lesson]);

  const parseLessonContentAndCountInteractions = useCallback((content: string): (string | JSX.Element)[] => {
    const elements: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let interactionCounter = 0;

    const generalCommentsRegex = /<!--(?!.*?INTERACTIVE_WORD_CHOICE:|.*?INTERACTIVE_FILL_IN_BLANK:).*?-->/gs;
    const contentWithoutGeneralComments = content.replace(generalCommentsRegex, '');

    let match;
    combinedRegex.lastIndex = 0;

    while ((match = combinedRegex.exec(contentWithoutGeneralComments)) !== null) {
      const interactionId = `lesson-${lesson.id}-interaction-${interactionCounter}`;
      interactionCounter++;

      if (match.index > lastIndex) {
        elements.push(contentWithoutGeneralComments.substring(lastIndex, match.index));
      }

      if (match[2]) { // INTERACTIVE_WORD_CHOICE
        const optionsString = match[2];
        if (optionsString) {
          const rawOptions = optionsString.split(';');
          let correctAnswer = "";
          const parsedOptions = rawOptions.map(opt => {
            const trimmedOpt = opt.trim();
            if (trimmedOpt.startsWith('*')) {
              correctAnswer = trimmedOpt.substring(1).trim();
              return trimmedOpt.substring(1).trim();
            }
            return trimmedOpt;
          }).filter(opt => opt.length > 0);

          if (parsedOptions.length > 0 && correctAnswer) {
            elements.push(
              <InteractiveWordChoice
                key={interactionId}
                interactionId={interactionId}
                options={shuffleArray(parsedOptions)}
                correctAnswer={correctAnswer}
                onCorrect={handleInteractionCorrect}
              />
            );
          } else {
            elements.push(`<!-- WC PARSE ERROR: ${match[0]} -->`);
          }
        } else {
           elements.push(`<!-- WC PARSE ERROR (no options string): ${match[0]} -->`);
        }
      } else if (match[4]) { // INTERACTIVE_FILL_IN_BLANK
        const optionsString = match[4];
        if (optionsString) {
          const allOptions = optionsString.split('|').map(opt => opt.trim()).filter(opt => opt.length > 0);
          if (allOptions.length > 0) {
            const correctAnswerFillIn = allOptions[0];
            elements.push(
              <InteractiveFillInBlank
                key={interactionId}
                interactionId={interactionId}
                options={allOptions}
                correctAnswer={correctAnswerFillIn}
                onCorrect={handleInteractionCorrect}
              />
            );
          } else {
             elements.push(`<!-- FB PARSE ERROR: ${match[0]} -->`);
          }
        } else {
          elements.push(`<!-- FB PARSE ERROR (no options string): ${match[0]} -->`);
        }
      }
      lastIndex = combinedRegex.lastIndex;
    }

    if (lastIndex < contentWithoutGeneralComments.length) {
      elements.push(contentWithoutGeneralComments.substring(lastIndex));
    }
    setTotalInteractiveElements(interactionCounter); // Mover para cá garante que seja chamado
    return elements;
  }, [lesson?.id, handleInteractionCorrect]); // Adicionado lesson.id como dependência

  const processedContentElements = useMemo(() => {
    if (lesson?.content) {
      return parseLessonContentAndCountInteractions(lesson.content);
    }
    return [];
  }, [lesson?.content, parseLessonContentAndCountInteractions]);

  const allInteractionsCompleted = useMemo(() => {
    return totalInteractiveElements === 0 || completedInteractionIds.size === totalInteractiveElements;
  }, [totalInteractiveElements, completedInteractionIds]);


  const isCompleted = useMemo(() => {
    if (authLoading) return false;
    if (userProfile && lesson) {
      return userProfile.completedLessons.includes(lesson.id);
    }
    return false;
  }, [userProfile, lesson, authLoading]);


  useEffect(() => {
    if (typeof window !== 'undefined' && lesson) {
        const currentLessonInteractionsKey = `${LOCAL_STORAGE_KEYS.GUEST_COMPLETED_LESSONS}_interactions_${lesson.id}`;
        const storedInteractions = localStorage.getItem(currentLessonInteractionsKey);
        if (storedInteractions) {
            try {
                const parsedInteractions = JSON.parse(storedInteractions);
                if (Array.isArray(parsedInteractions)) {
                    setCompletedInteractionIds(new Set(parsedInteractions));
                } else {
                    setCompletedInteractionIds(new Set());
                }
            } catch (error) {
                console.error("Error parsing stored interactions:", error);
                setCompletedInteractionIds(new Set());
            }
        } else {
            setCompletedInteractionIds(new Set());
        }
    }

    setIsMarkingComplete(false);

    // Lógica para encontrar lições adjacentes
    if (lesson?.moduleId && allMockLessons.length > 0) {
      const lessonsInModule = allMockLessons
        .filter(l => l.moduleId === lesson.moduleId)
        .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

      const currentIndex = lessonsInModule.findIndex(l => l.id === lesson.id);

      if (currentIndex > -1) {
        setPrevLesson(currentIndex > 0 ? lessonsInModule[currentIndex - 1] : null);
        setNextLesson(currentIndex < lessonsInModule.length - 1 ? lessonsInModule[currentIndex + 1] : null);
      } else {
        setPrevLesson(null);
        setNextLesson(null);
      }
    } else {
      setPrevLesson(null);
      setNextLesson(null);
    }
  }, [lesson]);


  const handleMarkAsCompleted = async () => {
    if (isCompleted || isMarkingComplete || !allInteractionsCompleted || !lesson) return;
    setIsMarkingComplete(true);

    const result = await markLessonCompletedAction(userProfile, lesson.id);

    if (result.success && result.updatedProfile) {
      updateUserProfile(result.updatedProfile); 
      playSound('pointGain');
      let toastMessage = "Lição marcada como concluída!";
      if (result.unlockedAchievementsDetails && result.unlockedAchievementsDetails.length > 0) {
        const achievementTitles = result.unlockedAchievementsDetails.map(a => a.title).join(', ');
        toastMessage += ' Você desbloqueou: ' + achievementTitles + '!';
        playSound('achievementUnlock');
      }
      toast({
        title: "Lição Concluída! 🎉",
        description: toastMessage,
        className: "bg-green-500 dark:bg-green-700 text-white dark:text-white",
      });
    } else {
      toast({
        title: "Erro",
        description: result.message || "Não foi possível marcar a lição como concluída.",
        variant: "destructive",
      });
    }
    setIsMarkingComplete(false);
  };

  if (authLoading || !lesson) { 
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  const interactionsProgressText = totalInteractiveElements > 0
    ? `Interações concluídas: ${completedInteractionIds.size} de ${totalInteractiveElements}`
    : "Nenhuma interação nesta lição.";

  return (
    <div className="max-w-4xl mx-auto py-8">
      <Card className="overflow-hidden shadow-xl">
        <CardHeader>
          {lesson.coverImage && (
             <div className="relative aspect-video mb-6 rounded-lg overflow-hidden max-h-[300px]">
               <Image
                src={lesson.coverImage}
                alt={lesson.title || "Imagem da lição"}
                fill
                style={{objectFit:"cover"}}
                sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="transition-transform duration-500 hover:scale-105"
                data-ai-hint={lesson.aiHint || "visualização dados estatisticos"}
                priority
              />
             </div>
          )}
          <CardTitle className="text-3xl font-bold tracking-tight md:text-4xl">{lesson.title}</CardTitle>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
            <div className="flex items-center">
              <Clock className="h-4 w-4 mr-1" />
              <span>{lesson.estimatedTime}</span>
            </div>
            <span className="capitalize">Tipo: {lesson.type}</span>
          </div>
           {totalInteractiveElements > 0 && (
            <div className="mt-3 text-sm text-primary flex items-center">
                <Info className="h-4 w-4 mr-1.5 shrink-0" />
                <span>{interactionsProgressText}</span>
            </div>
           )}
        </CardHeader>
        <CardContent className="prose prose-lg dark:prose-invert max-w-none p-6">
          {renderContentWithParagraphs(processedContentElements, `lesson-${lesson.id}`)}
        </CardContent>
          {lesson.references && lesson.references.length > 0 && (
            <>
              <div className="px-6 pb-6">
                  <Separator className="my-6" />
                  <div className="not-prose">
                      <h3 className="text-xl font-semibold mb-4 text-foreground">Referências</h3>
                      <ul className="list-none p-0 space-y-2">
                      {lesson.references.map((ref, index) => (
                          <li
                          key={`ref-${index}`}
                          className="text-sm text-muted-foreground"
                          dangerouslySetInnerHTML={{ __html: ref }}
                          />
                      ))}
                      </ul>
                  </div>
              </div>
            </>
          )}
      </Card>

      <CardFooter className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-4 p-6 bg-muted/30 rounded-lg">
        <div className="w-full sm:w-1/3 flex justify-center sm:justify-start">
            {prevLesson ? (
            <Button variant="outline" size="default" asChild className="w-full sm:w-auto">
                <Link href={`/lessons/${prevLesson.id}`}>
                  <span className="flex items-center justify-center w-full">
                    <ArrowLeft className="h-4 w-4 mr-1 sm:mr-2" />
                    <span className="truncate hidden sm:inline">Anterior</span>
                    <span className="sm:hidden">Anterior</span>
                  </span>
                </Link>
            </Button>
            ) : <div className="w-full sm:w-auto">&nbsp;</div>} {/* Placeholder for alignment */}
        </div>

        <div className="w-full sm:w-1/3 flex-shrink-0 my-2 sm:my-0 flex justify-center">
            <Button
              variant={isCompleted ? "default" : "secondary"}
              size="lg"
              className={cn(
                "w-full max-w-xs sm:w-auto", // Limit width on small screens
                isCompleted ? "bg-green-500 hover:bg-green-600" :
                (!allInteractionsCompleted && totalInteractiveElements > 0) ? "bg-gray-300 hover:bg-gray-400 text-gray-600 cursor-not-allowed" : ""
              )}
              onClick={handleMarkAsCompleted}
              disabled={isCompleted || isMarkingComplete || (!allInteractionsCompleted && totalInteractiveElements > 0)}
            >
                {isMarkingComplete ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : isCompleted ? (
                    <CheckCircle className="mr-2 h-5 w-5" />
                ) : (
                    <CheckCircle className="mr-2 h-5 w-5" />
                )}
                {isMarkingComplete
                    ? "Marcando..."
                    : isCompleted
                        ? "Concluída"
                        : (!allInteractionsCompleted && totalInteractiveElements > 0)
                            ? "Complete Interações"
                            : "Marcar Concluída"
                }
            </Button>
        </div>

        <div className="w-full sm:w-1/3 flex justify-center sm:justify-end">
            {nextLesson ? (
            <Button variant="outline" size="default" asChild className="w-full sm:w-auto">
                <Link href={`/lessons/${nextLesson.id}`}>
                  <span className="flex items-center justify-center w-full">
                    <span className="truncate hidden sm:inline">Próxima</span>
                    <span className="sm:hidden">Próxima</span>
                    <ArrowRight className="h-4 w-4 ml-1 sm:ml-2" />
                  </span>
                </Link>
            </Button>
            ) : <div className="w-full sm:w-auto">&nbsp;</div>} {/* Placeholder for alignment */}
        </div>
      </CardFooter>
    </div>
  );
}
