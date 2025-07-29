import React, { useState, useEffect } from 'react';
import { Zap, X, Send, Download, RotateCcw, FileText, Brain, CheckCircle, Loader2, Plus, ChevronDown, TrendingUp, TestTube } from 'lucide-react';
import type { AppMode } from '../App';
import { apiService, getPagesWithType, PageWithType } from '../services/api';
import { getConfluenceSpaceAndPageFromUrl } from '../utils/urlUtils';
import { formatAIPoweredSearchOutput, formatCodeAssistantOutput, formatImageInsightsOutput, formatVideoSummarizerOutput } from '../utils/toolOutputFormatters';
import VoiceRecorder from './VoiceRecorder';

interface AgentModeProps {
  onClose: () => void;
  onModeSelect: (mode: AppMode) => void;
  autoSpaceKey?: string | null;
  isSpaceAutoConnected?: boolean;
}

interface PlanStep {
  id: number;
  title: string;
  status: 'pending' | 'running' | 'completed';
  details?: string;
}

interface OutputTab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  content: string;
}



// Helper to split user input into actionable instructions
function splitInstructions(input: string): string[] {
  // Split on common instruction separators, but be more careful about preserving context
  const instructions = input
    .split(/\band\b|\bthen\b|\n|\r|\r\n|\.|;|,|\|\||\|\s/i)
    .map(instr => instr.trim())
    .filter(instr => instr.length > 0 && instr.length > 3); // Filter out very short fragments
  
  // If we only have one instruction, don't split it further
  if (instructions.length === 1) {
    return instructions;
  }
  
  // For multiple instructions, try to preserve page-specific context
  const refinedInstructions: string[] = [];
  
  for (const instruction of instructions) {
    // If instruction mentions specific page names, keep it as is
    if (/page|image|code|video|text/i.test(instruction)) {
      refinedInstructions.push(instruction);
    } else {
      // For generic instructions, keep them as is
      refinedInstructions.push(instruction);
    }
  }
  
  return refinedInstructions;
}

// Helper to split a single instruction with multiple related actions (e.g., 'optimize and convert')
function splitRelatedActions(instruction: string): string[] {
  // Heuristic: split on ' and ', ' then ', or ';' if the actions are likely related
  // This can be improved with NLP if needed
  return instruction
    .split(/\band\b|\bthen\b|;/i)
    .map(instr => instr.trim())
    .filter(instr => instr.length > 0);
}

// Extend OutputTab type for results
interface OutputTabWithResults extends OutputTab {
  results?: Array<any>;
}

interface HistoryEntry {
  id: string;
  goal: string;
  timestamp: Date;
  outputTabs: OutputTabWithResults[];
  selectedSpace: string;
  selectedPages: string[];
}



const AgentMode: React.FC<AgentModeProps> = ({ onClose, onModeSelect, autoSpaceKey, isSpaceAutoConnected }) => {
  const [goal, setGoal] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting] = useState(false);
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [, setCurrentStep] = useState(0);
  const [activeTab, setActiveTab] = useState('answer');
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [outputTabs, setOutputTabs] = useState<OutputTabWithResults[]>([]);

  // Add new state for space/page selection and API results
  const [spaces, setSpaces] = useState<{ name: string; key: string }[]>([]);
  const [pages, setPages] = useState<string[]>([]);
  const [selectedSpace, setSelectedSpace] = useState('');
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [selectAllPages, setSelectAllPages] = useState(false);
  const [pageTypes, setPageTypes] = useState<PageWithType[]>([]);

  // Add progressPercent state for live progress bar
  const [progressPercent, setProgressPercent] = useState(0);
  const [activeResult, setActiveResult] = useState<{ type: string, key: string, page?: string, instructionIndex?: number } | null>(null);

  // History state variables
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);

  // Auto-detect and auto-select space and page if only one exists, or from URL if provided
  useEffect(() => {
    const loadSpacesAndPages = async () => {
      try {
        const result = await apiService.getSpaces();
        setSpaces(result.spaces);
        // Auto-select space from URL if provided
        if (autoSpaceKey && isSpaceAutoConnected) {
          setSelectedSpace(autoSpaceKey);
          const pagesResult = await apiService.getPages(autoSpaceKey);
          setPages(pagesResult.pages);
          // Auto-select page from URL if present
          const { page } = getConfluenceSpaceAndPageFromUrl();
          if (page && pagesResult.pages.includes(page)) {
            setSelectedPages([page]);
          }
        } else if (result.spaces.length === 1) {
          const onlySpace = result.spaces[0];
          setSelectedSpace(onlySpace.key);
          const pagesResult = await apiService.getPages(onlySpace.key);
          setPages(pagesResult.pages);
          if (pagesResult.pages.length === 1) {
            setSelectedPages([pagesResult.pages[0]]);
          }
        }
      } catch {
        setError('Failed to auto-detect Confluence space and page.');
      }
    };
    loadSpacesAndPages();
  }, [autoSpaceKey, isSpaceAutoConnected]);

  // Load pages when space is selected, and auto-select page if only one exists or from URL
  useEffect(() => {
    if (selectedSpace) {
      const loadPages = async () => {
        try {
          const result = await apiService.getPages(selectedSpace);
          setPages(result.pages);
          // Auto-select page from URL if present
          const { page } = getConfluenceSpaceAndPageFromUrl();
          if (page && result.pages.includes(page)) {
            setSelectedPages([page]);
          } else if (result.pages.length === 1) {
            setSelectedPages([result.pages[0]]);
          }
        } catch {
          setError('Failed to load pages.');
        }
      };
      loadPages();
    }
  }, [selectedSpace]);

  // Fetch page types when space or pages change
  useEffect(() => {
    const fetchPageTypes = async () => {
      if (selectedSpace) {
        try {
          const result = await getPagesWithType(selectedSpace);
          setPageTypes(result.pages);
        } catch {
          // fallback: just set empty
          setPageTypes([]);
        }
      }
    };
    fetchPageTypes();
  }, [selectedSpace, pages.length]);

  // Sync "Select All" checkbox state
  useEffect(() => {
    setSelectAllPages(pages.length > 0 && selectedPages.length === pages.length);
  }, [selectedPages, pages]);

  const toggleSelectAllPages = () => {
    if (selectAllPages) {
      setSelectedPages([]);
    } else {
      setSelectedPages([...pages]);
    }
    setSelectAllPages(!selectAllPages);
  };

  const handleGoalSubmit = async () => {
    if (!goal.trim() || !selectedSpace || !selectedPages.length) {
      setError('Please enter a goal, select a space, and at least one page.');
      return;
    }
    setIsPlanning(true);
    setError('');
    setPlanSteps([
      { id: 1, title: 'Analyzing Goal', status: 'pending' },
      { id: 2, title: 'Executing', status: 'pending' },
    ]);
    setOutputTabs([]);
    setCurrentStep(0);
    setActiveTab('final-answer');
    setProgressPercent(0);
    setCurrentHistoryId(null);
    setShowHistory(false);
    let impactAnalyzerResult: React.ReactNode | null = null;
    let testStrategyResult: React.ReactNode | null = null;
    const toolsTriggered: string[] = [];
    const whyUsed: string[] = [];
    const howDerived: string[] = [];
    try {
      setPlanSteps((steps) => steps.map((s) => s.id === 1 ? { ...s, status: 'running' } : s));
      setCurrentStep(0);
      // Split instructions
      const instructions = splitInstructions(goal);
      // Map each instruction to the correct page/tool based on content type and intent
      const pageResults: Record<string, Array<{ instruction: string, tool: string, outputs: string[], formattedOutput: string }>> = {};
      
      // Analyze instructions to determine required tools
      const requiredTools = new Set<string>();
      const instructionTools: { instruction: string, tools: string[] }[] = [];
      
      for (const instruction of instructions) {
        const lowerInstruction = instruction.toLowerCase();
        const tools: string[] = [];
        
        // Detect video-related instructions
        if (/video|summarize.*video|transcribe|video.*summarize/.test(lowerInstruction)) {
          tools.push('video_summarizer');
        }
        
        // Detect image-related instructions (more specific)
        if (/image|chart|diagram|visual|image.*summarize|summarize.*image|analyze.*image|image.*analyze/.test(lowerInstruction)) {
          tools.push('image_insights');
        }
        
        // Detect code-related instructions (more specific)
        if (/convert.*language|language.*convert|debug|refactor|fix|bug|error|optimize|performance|documentation|docs|comment|dead code|unused|logging|log|code.*convert|convert.*code/.test(lowerInstruction)) {
          tools.push('code_assistant');
        }
        
        // Detect text-related instructions (more specific)
        if (/text|summarize.*text|text.*summarize|summarize.*page|page.*summarize|summarize/.test(lowerInstruction)) {
          tools.push('ai_powered_search');
        }
        
        // Detect special tools
        if (/impact|change|difference|diff/.test(lowerInstruction)) {
          tools.push('impact_analyzer');
        }
        if (/test|qa|test case|unit test/.test(lowerInstruction)) {
          tools.push('test_support');
        }
        
        // If no specific tool detected, default to AI Powered Search
        if (tools.length === 0) {
          tools.push('ai_powered_search');
        }
        
        tools.forEach(tool => requiredTools.add(tool));
        instructionTools.push({ instruction, tools });
      }
      
      // Get content types for each page
      const pageContentTypes = new Map<string, string>();
      for (const page of selectedPages) {
        const type = (pageTypes.find(p => p.title === page)?.content_type) || 'text';
        pageContentTypes.set(page, type);
      }
      
      // Improved instruction-to-page matching algorithm
      const pageInstructions: { page: string, instruction: string, tool: string }[] = [];
      const usedInstructions = new Set<string>();
      
      // First pass: Try to match instructions that explicitly mention page names
      for (const page of selectedPages) {
        const pageType = pageContentTypes.get(page) || 'text';
        let matchedInstruction: string | null = null;
        let matchedTool: string | null = null;
        
        // Look for instructions that explicitly mention this page name
        for (const { instruction, tools } of instructionTools) {
          const lowerInstruction = instruction.toLowerCase();
          const lowerPageName = page.toLowerCase();
          
          // Check if instruction mentions this specific page
          if (lowerInstruction.includes(lowerPageName) || 
              lowerInstruction.includes(lowerPageName.replace(/\s+/g, '_')) ||
              lowerInstruction.includes(lowerPageName.replace(/\s+/g, '-'))) {
            
            // Find the best tool for this instruction and page type
            let bestTool = 'ai_powered_search';
            
            if (pageType === 'video' && tools.includes('video_summarizer')) {
              bestTool = 'video_summarizer';
            } else if (pageType === 'image' && tools.includes('image_insights')) {
              bestTool = 'image_insights';
            } else if (pageType === 'code' && tools.includes('code_assistant')) {
              bestTool = 'code_assistant';
            } else if (pageType === 'text' && tools.includes('ai_powered_search')) {
              bestTool = 'ai_powered_search';
            } else if (tools.length > 0) {
              bestTool = tools[0];
            }
            
            matchedInstruction = instruction;
            matchedTool = bestTool;
            usedInstructions.add(instruction);
            break;
          }
        }
        
        // If no explicit page name match, try content type matching
        if (!matchedInstruction) {
          for (const { instruction, tools } of instructionTools) {
            if (usedInstructions.has(instruction)) continue;
            
            const lowerInstruction = instruction.toLowerCase();
            let bestTool = 'ai_powered_search';
            
            // Match based on content type and instruction keywords
            if (pageType === 'video' && tools.includes('video_summarizer')) {
              bestTool = 'video_summarizer';
            } else if (pageType === 'image' && tools.includes('image_insights')) {
              bestTool = 'image_insights';
            } else if (pageType === 'code' && tools.includes('code_assistant')) {
              bestTool = 'code_assistant';
            } else if (pageType === 'text' && tools.includes('ai_powered_search')) {
              bestTool = 'ai_powered_search';
            } else if (tools.length > 0) {
              bestTool = tools[0];
            }
            
            // Additional keyword matching for better accuracy
            if (pageType === 'image' && /image|chart|diagram|visual/.test(lowerInstruction)) {
              bestTool = 'image_insights';
            } else if (pageType === 'code' && /convert|debug|refactor|fix|bug|error|optimize|performance|documentation|docs|comment|dead code|unused|logging|log|code/.test(lowerInstruction)) {
              bestTool = 'code_assistant';
            } else if (pageType === 'video' && /video|summarize.*video|transcribe/.test(lowerInstruction)) {
              bestTool = 'video_summarizer';
            }
            
            matchedInstruction = instruction;
            matchedTool = bestTool;
            usedInstructions.add(instruction);
            break;
          }
        }
        
        // If still no match, use the first available instruction
        if (!matchedInstruction) {
          for (const { instruction, tools } of instructionTools) {
            if (usedInstructions.has(instruction)) continue;
            
            let bestTool = 'ai_powered_search';
            if (tools.length > 0) {
              bestTool = tools[0];
            }
            
            matchedInstruction = instruction;
            matchedTool = bestTool;
            usedInstructions.add(instruction);
            break;
          }
        }
        
        // If no instruction available, use a default one
        if (!matchedInstruction) {
          matchedInstruction = instructions[0] || 'Analyze this content';
          matchedTool = 'ai_powered_search';
        }
        
        pageInstructions.push({ 
          page, 
          instruction: matchedInstruction, 
          tool: matchedTool || 'ai_powered_search'
        });
      }
      
      for (const { page, instruction, tool } of pageInstructions) {
        let outputs: string[] = [];
        let formattedOutput = '';
        
        if (tool === 'code_assistant') {
          // Handle AI actions for code pages
          const relatedActions = splitRelatedActions(instruction);
          let lastOutput = '';
          let aiActionOutput = '';
          let conversionOutput = '';
          let modificationOutput = '';
          // Get the original code first to use in prompts (like Tool Mode does)
          const initialResult = await apiService.codeAssistant({
            space_key: selectedSpace,
            page_title: page,
            instruction: ''
          });
          const detectedCode = initialResult.original_code || '';
          const actionPromptMap: Record<string, string> = {
            "Summarize Code": `Summarize the following code in clear and concise language:\n\n${detectedCode}`,
            "Optimize Performance": `Optimize the following code for performance without changing its functionality, return only the updated code:\n\n${detectedCode}`,
            "Generate Documentation": `Generate inline documentation and function-level comments for the following code, return only the updated code by commenting the each line of the code.:\n\n${detectedCode}`,
            "Refactor Structure": `Refactor the following code to improve structure, readability, and modularity, return only the updated code:\n\n${detectedCode}`,
            "Identify dead code": `Analyze the following code for any unsued code or dead code, return only the updated code by removing the dead code:\n\n${detectedCode}`,
            "Add Logging Statements": `Add appropriate logging statements to the following code for better traceability and debugging. Return only the updated code:\n\n${detectedCode}`,
          };
          for (const action of relatedActions) {
            let prompt = action;
            if (/optimize|performance/i.test(action)) {
              prompt = actionPromptMap["Optimize Performance"];
            } else if (/documentation|docs|comment/i.test(action)) {
              prompt = actionPromptMap["Generate Documentation"];
            } else if (/refactor|structure/i.test(action)) {
              prompt = actionPromptMap["Refactor Structure"];
            } else if (/dead code|unused/i.test(action)) {
              prompt = actionPromptMap["Identify dead code"];
            } else if (/logging|log/i.test(action)) {
              prompt = actionPromptMap["Add Logging Statements"];
            } else if (/summarize|summary/i.test(action)) {
              prompt = actionPromptMap["Summarize Code"];
            }
            const result = await apiService.codeAssistant({
              space_key: selectedSpace,
              page_title: page,
              instruction: prompt
            });
            const output = result.modified_code || result.converted_code || result.original_code || 'AI action completed successfully.';
            if (/optimize|refactor|dead code|docs|logging|summarize/i.test(action)) {
              aiActionOutput = output;
            } else if (/convert|language|to\s+\w+/i.test(action)) {
              conversionOutput = output;
            } else {
              modificationOutput = output;
            }
            lastOutput = output;
          }
          if (aiActionOutput) outputs.push(`AI Action Output:\n${aiActionOutput}`);
          if (conversionOutput) outputs.push(`Target Language Conversion Output:\n${conversionOutput}`);
          if (modificationOutput) outputs.push(`Modification Output:\n${modificationOutput}`);
          if (!aiActionOutput && !conversionOutput && !modificationOutput && lastOutput) {
            outputs.push(`Processed Code:\n${lastOutput}`);
          }
          formattedOutput = formatCodeAssistantOutput(outputs);
          toolsTriggered.push('Code Assistant');
          whyUsed.push(`Code Assistant was used to ${instruction.toLowerCase()} for the code page "${page}".`);
          howDerived.push(`The code was processed using AI-powered analysis and transformation techniques.`);
        } else if (tool === 'image_insights') {
          // Image summarization using ImageInsights tool (no web search)
          const images = await apiService.getImages(selectedSpace, page);
          let output = '';
          if (images && images.images && images.images.length > 0) {
            const summaries = await Promise.all(images.images.map((imgUrl: string) => apiService.imageSummary({ space_key: selectedSpace, page_title: page, image_url: imgUrl })));
            output = summaries.map((s, i) => `Image ${i + 1}: ${s.summary}`).join('\n\n');
          } else {
            output = 'No images found on this page.';
          }
          outputs.push(output);
          formattedOutput = formatImageInsightsOutput([{ name: page, summary: output }]);
          toolsTriggered.push('Image Insights');
          whyUsed.push(`Image Insights was used to analyze and summarize the images on page "${page}".`);
          howDerived.push(`The images were processed using computer vision and AI analysis to extract meaningful insights and descriptions.`);
        } else if (tool === 'ai_powered_search') {
          // Only use AI Powered Search for text/code content, NOT for video/image
          const res = await apiService.search({ space_key: selectedSpace, page_titles: [page], query: instruction });
          outputs.push(res.response);
          formattedOutput = formatAIPoweredSearchOutput(res.response);
          toolsTriggered.push('AI Powered Search');
          whyUsed.push(`AI Powered Search was used to analyze and summarize the content on page "${page}".`);
          howDerived.push(`The content was processed using natural language processing to extract key information and provide comprehensive summaries.`);
        } else if (tool === 'video_summarizer') {
          // Video summarization using exact same logic as Tool Mode
          const res = await apiService.videoSummarizer({ space_key: selectedSpace, page_title: page });
          
          // Create video content object similar to Tool Mode
          const videoContent = {
            id: Date.now().toString(),
            name: page,
            summary: res.summary,
            quotes: res.quotes,
            timestamps: res.timestamps,
            qa: res.qa
          };
          
          // Format output using the same structure as Tool Mode
          const summaryText = videoContent.summary || 'No summary available.';
          const quotesText = videoContent.quotes && videoContent.quotes.length > 0 
            ? `\n\nKey Quotes:\n${videoContent.quotes.map(quote => `- "${quote}"`).join('\n')}`
            : '';
          const timestampsText = videoContent.timestamps && videoContent.timestamps.length > 0
            ? `\n\nTimestamps:\n${videoContent.timestamps.map(ts => `- ${ts}`).join('\n')}`
            : '';
          
          const fullOutput = `${summaryText}${quotesText}${timestampsText}`;
          outputs.push(fullOutput);
          
          // Use the existing formatter function to maintain consistency
          formattedOutput = formatVideoSummarizerOutput({
            name: videoContent.name,
            summary: videoContent.summary,
            timestamps: videoContent.timestamps || [],
            quotes: videoContent.quotes || []
          });
          
          toolsTriggered.push('Video Summarizer');
          whyUsed.push(`Video Summarizer was used to analyze and summarize the video content on page "${page}".`);
          howDerived.push(`The video was processed using AI-powered analysis to extract key moments, timestamps, and comprehensive summaries.`);
        } else {
          // Fallback: use AI Powered Search for any other type (never web search)
          const res = await apiService.search({ space_key: selectedSpace, page_titles: [page], query: instruction });
          outputs.push(res.response);
          formattedOutput = formatAIPoweredSearchOutput(res.response);
          toolsTriggered.push('AI Powered Search');
          whyUsed.push(`AI Powered Search was used as a fallback to analyze the content on page "${page}".`);
          howDerived.push(`The content was processed using general AI analysis to provide relevant information.`);
        }
        if (!pageResults[page]) pageResults[page] = [];
        // Only push the result for this page/instruction pair
        pageResults[page].push({ instruction, tool, outputs, formattedOutput });
      }
      
      // Handle special cases for Impact Analyzer and Test Strategy
      if (selectedPages.length === 2) {
        const hasImpactInstruction = instructions.some(instruction => /impact|compare|difference|diff/i.test(instruction));
        const hasTestInstruction = instructions.some(instruction => /test|qa|test case|unit test/i.test(instruction));
        
        if (hasImpactInstruction) {
          const [oldPage, newPage] = selectedPages;
          const res = await apiService.impactAnalyzer({ space_key: selectedSpace, old_page_title: oldPage, new_page_title: newPage, question: goal });
          impactAnalyzerResult = (
            <div className="bg-white/60 backdrop-blur-xl rounded-xl p-4 border border-white/20 shadow-lg max-w-4xl mx-auto">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center">
                <TrendingUp className="w-5 h-5 mr-2 text-orange-500" />
                Impact Analysis: {oldPage} vs {newPage}
              </h3>
              <div className="mb-6">
                <h4 className="font-semibold text-gray-800 mb-3">Change Metrics</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-green-100/80 backdrop-blur-sm p-3 rounded-lg text-center border border-white/20">
                    <div className="font-semibold text-green-800 text-lg">+{res.lines_added || 0}</div>
                    <div className="text-green-600 text-xs">Lines Added</div>
                  </div>
                  <div className="bg-red-100/80 backdrop-blur-sm p-3 rounded-lg text-center border border-white/20">
                    <div className="font-semibold text-red-800 text-lg">-{res.lines_removed || 0}</div>
                    <div className="text-red-600 text-xs">Lines Removed</div>
                  </div>
                  <div className="bg-blue-100/80 backdrop-blur-sm p-3 rounded-lg text-center border border-white/20">
                    <div className="font-semibold text-blue-800 text-lg">{res.files_changed || 1}</div>
                    <div className="text-blue-600 text-xs">Files Changed</div>
                  </div>
                  <div className="bg-purple-100/80 backdrop-blur-sm p-3 rounded-lg text-center border border-white/20">
                    <div className="font-semibold text-purple-800 text-lg">{res.percentage_change || 0}%</div>
                    <div className="text-purple-600 text-xs">Percentage Changed</div>
                  </div>
                </div>
              </div>
              <div className="mb-6">
                <h4 className="font-semibold text-gray-800 mb-3">Risk Assessment</h4>
                <div className={`p-4 rounded-lg flex items-center space-x-3 border ${res.risk_level === 'low' ? 'text-green-700 bg-green-100/80 border-green-200/50' : res.risk_level === 'medium' ? 'text-yellow-700 bg-yellow-100/80 border-yellow-200/50' : 'text-red-700 bg-red-100/80 border-red-200/50'}`}>
                  <span className="text-2xl">{res.risk_level === 'low' ? '🟢' : res.risk_level === 'medium' ? '🟡' : '⚠️'}</span>
                  <div>
                    <div className="font-semibold capitalize text-lg">{res.risk_level || 'low'} Risk</div>
                    <div className="text-sm">Risk Score: {res.risk_score || 0}/10</div>
                  </div>
                </div>
              </div>
              <div className="mb-6">
                <h3 className="font-semibold text-gray-800 mb-4">Code Diff</h3>
                <div className="bg-gray-900/90 backdrop-blur-sm rounded-lg p-4 overflow-auto max-h-80 border border-white/10">
                  <pre className="text-sm">
                    <code>
                      {res.diff && res.diff.split('\n').map((line: string, idx: number) => (
                        <div
                          key={idx}
                          className={
                            line.startsWith('+') ? 'text-green-400' :
                            line.startsWith('-') ? 'text-red-400' :
                            line.startsWith('@@') ? 'text-blue-400' :
                            'text-gray-300'
                          }
                        >
                          {line}
                        </div>
                      ))}
                    </code>
                  </pre>
                </div>
              </div>
              <div className="mb-6">
                <h3 className="font-semibold text-gray-800 mb-4">AI Impact Summary</h3>
                <div className="bg-white/70 backdrop-blur-sm rounded-lg p-4 border border-white/20 prose prose-sm max-w-none">
                  {res.impact_analysis && res.impact_analysis.split('\n').map((line: string, idx: number) => (
                    <p key={idx} className="mb-2 text-gray-700">{line}</p>
                  ))}
                </div>
              </div>
            </div>
          );
          toolsTriggered.push('Impact Analyzer');
          whyUsed.push(`Impact Analyzer was used to compare the changes between "${oldPage}" and "${newPage}".`);
          howDerived.push(`The analysis was performed by comparing code differences, calculating metrics, and assessing potential risks.`);
        }
        
        if (hasTestInstruction) {
          const [codePage, testInputPage] = selectedPages;
          const res = await apiService.testSupport({ space_key: selectedSpace, code_page_title: codePage, test_input_page_title: testInputPage, question: goal });
          testStrategyResult = (
            <div className="bg-white/60 backdrop-blur-xl rounded-xl p-4 border border-white/20 shadow-lg max-w-4xl mx-auto">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center">
                <TestTube className="w-5 h-5 mr-2 text-orange-500" />
                Test Strategy: {codePage} & {testInputPage}
              </h3>
              <div className="bg-white/70 backdrop-blur-sm rounded-lg p-4 border border-white/20 prose prose-sm max-w-none">
                {res.test_strategy && res.test_strategy.split('\n').map((line: string, idx: number) => {
                  if (line.startsWith('### ')) {
                    return <h3 key={idx} className="text-lg font-bold text-gray-800 mt-4 mb-2">{line.substring(4)}</h3>;
                  } else if (line.startsWith('## ')) {
                    return <h2 key={idx} className="text-xl font-bold text-gray-800 mt-6 mb-3">{line.substring(3)}</h2>;
                  } else if (line.startsWith('# ')) {
                    return <h1 key={idx} className="text-2xl font-bold text-gray-800 mt-8 mb-4">{line.substring(2)}</h1>;
                  } else if (line.startsWith('- **')) {
                    const match = line.match(/- \*\*(.*?)\*\*: (.*)/);
                    if (match) {
                      return <p key={idx} className="mb-2"><strong>{match[1]}:</strong> {match[2]}</p>;
                    }
                  } else if (line.startsWith('- ')) {
                    return <p key={idx} className="mb-1 ml-4">• {line.substring(2)}</p>;
                  } else if (line.trim()) {
                    return <p key={idx} className="mb-2 text-gray-700">{line}</p>;
                  }
                  return <br key={idx} />;
                })}
              </div>
            </div>
          );
          toolsTriggered.push('Test Support Tool');
          whyUsed.push(`Test Support Tool was used to generate test strategies for "${codePage}" using "${testInputPage}" as input.`);
          howDerived.push(`The test strategy was generated by analyzing the code structure and test requirements using AI-powered testing methodologies.`);
        }
      }
      
      setPlanSteps((steps) => steps.map((s) => s.id === 1 ? { ...s, status: 'completed' } : s));
      setCurrentStep(1);
      setProgressPercent(50);
      setPlanSteps((steps) => steps.map((s) => s.id === 2 ? { ...s, status: 'running' } : s));
      setPlanSteps((steps) => steps.map((s) => s.id === 2 ? { ...s, status: 'completed' } : s));
      setCurrentStep(2);
      setProgressPercent(100);
      // Prepare output tabs for new UI
      const pageTabs = Object.keys(pageResults).length > 0 || impactAnalyzerResult || testStrategyResult ? [
        {
          id: 'per-page-results',
          label: 'Page Results',
          icon: FileText,
          content: '',
          results: [
            ...(impactAnalyzerResult ? [{ impactAnalyzerResult }] : []),
            ...(testStrategyResult ? [{ testStrategyResult }] : []),
            ...Object.entries(pageResults).map(([page, results]) => ({ page, results })),
          ],
        }
      ] : [];
      const tabs = [
        ...pageTabs,
        {
          id: 'reasoning',
          label: 'Reasoning',
          icon: Brain,
          content: `# Analysis Summary

## Goal
${goal}

## Selected Pages
${selectedPages.join(', ')}

## Tools Used
${[...new Set(toolsTriggered)].join(', ')}

## Why These Tools Were Chosen

${whyUsed.map((reason, index) => `${index + 1}. ${reason}`).join('\n')}

## How Results Were Derived

${howDerived.map((method, index) => `${index + 1}. ${method}`).join('\n')}

## Processing Summary

- **Total Instructions Processed:** ${instructions.length}
- **Pages Analyzed:** ${selectedPages.length}
- **Analysis Completed:** ${new Date().toLocaleString()}

---

The AI assistant analyzed your request and automatically selected the most appropriate tools based on the content type of each page and the nature of your instructions. Each tool was chosen to provide the most relevant and accurate results for your specific needs.`,
        },
        {
          id: 'selected-pages',
          label: 'Selected Pages',
          icon: FileText,
          content: selectedPages.join(', '),
        },
      ];
      setOutputTabs(tabs);
      setActiveTab(pageTabs.length > 0 ? 'per-page-results' : 'reasoning');
      setActiveResult(null);
      
      // Add to history
      addToHistory(goal, tabs);
    } catch {
      setError('An error occurred during orchestration.');
    }
    setIsPlanning(false);
    setCurrentStep(2);
    setProgressPercent(100);
  };





  const handleFollowUp = async () => {
    if (!followUpQuestion.trim() || !selectedSpace || selectedPages.length === 0) return;
    try {
      const searchResult = await apiService.search({
        space_key: selectedSpace,
        page_titles: selectedPages,
        query: followUpQuestion,
      });
      const qaContent = outputTabs.find(tab => tab.id === 'qa')?.content || '';
      const updatedQA = `${qaContent}\n\n**Q: ${followUpQuestion}**\n\nA: ${searchResult.response}`;
      setOutputTabs(prev => prev.map(tab =>
        tab.id === 'qa' ? { ...tab, content: updatedQA } : tab
      ));
      setFollowUpQuestion('');
    } catch {
      setError('Failed to get follow-up answer.');
    }
  };

  const exportPlan = () => {
    const isHistoryExport = currentHistoryId !== null;
    const historyEntry = isHistoryExport ? history.find(h => h.id === currentHistoryId) : null;
    
    const content = `# AI Agent Analysis Report${isHistoryExport ? ' (Historical)' : ''}

## Goal
${goal}

${isHistoryExport ? `## Original Execution Date
${historyEntry?.timestamp.toLocaleString()}

## Selected Space
${spaces.find(s => s.key === selectedSpace)?.name || selectedSpace}

## Selected Pages
${selectedPages.join(', ')}

` : `## Execution Plan
${planSteps.map(step => `${step.id}. ${step.title} - ${step.status}`).join('\n')}

`}

## Analysis Results

${outputTabs.map(tab => {
  if (tab.id === 'per-page-results' && tab.results) {
    return `### ${tab.label}\n\n${tab.results.map((result: Record<string, unknown>) => {
      if ('impactAnalyzerResult' in result) {
        return '**Impact Analyzer Results**\n[Complex output - see UI for details]';
      } else if ('testStrategyResult' in result) {
        return '**Test Strategy Results**\n[Complex output - see UI for details]';
      } else if (result.page) {
        return `**${result.page}**\n${(result.results as Array<Record<string, unknown>>)?.map((r: Record<string, unknown>) => `- ${r.instruction}: ${(r.formattedOutput as string).substring(0, 200)}...`).join('\n') || 'No results'}`;
      }
      return '';
    }).filter(Boolean).join('\n\n')}`;
  } else {
    return `### ${tab.label}\n\n${tab.content}`;
  }
}).join('\n\n')}

---
*Generated by Confluence AI Assistant - Agent Mode*
*Date: ${new Date().toLocaleString()}*
${isHistoryExport ? `*Historical Entry ID: ${currentHistoryId}*` : ''}`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isHistoryExport ? `ai-agent-history-${currentHistoryId}.md` : 'ai-agent-analysis.md';
    a.click();
  };

  const backToChat = () => {
    setPlanSteps([]);
    setCurrentStep(0);
    setOutputTabs([]);
    setShowFollowUp(false);
    setActiveTab('answer');
    setGoal('');
    setError('');
    setProgressPercent(0);
    setActiveResult(null);
    setCurrentHistoryId(null);
    setShowHistory(false);
  };

  // History management functions
  const addToHistory = (goal: string, outputTabs: OutputTabWithResults[]) => {
    const historyEntry: HistoryEntry = {
      id: Date.now().toString(),
      goal,
      timestamp: new Date(),
      outputTabs,
      selectedSpace,
      selectedPages: [...selectedPages]
    };
    setHistory(prev => [historyEntry, ...prev]);
  };

  const loadHistoryEntry = (historyId: string) => {
    const entry = history.find(h => h.id === historyId);
    if (entry) {
      setOutputTabs(entry.outputTabs);
      setSelectedSpace(entry.selectedSpace);
      setSelectedPages(entry.selectedPages);
      setGoal(entry.goal);
      setCurrentHistoryId(historyId);
      setActiveTab(entry.outputTabs.length > 0 ? entry.outputTabs[0].id : 'answer');
      setPlanSteps([]);
      setCurrentStep(0);
      setProgressPercent(100);
      setActiveResult(null);
    }
  };

  const goToLatest = () => {
    if (history.length > 0) {
      loadHistoryEntry(history[0].id);
    }
  };

  const toggleHistory = () => {
    setShowHistory(!showHistory);
  };

  return (
    <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-40 p-4">
      <div className="bg-white/80 backdrop-blur-xl border-2 border-[#DFE1E6] rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500/90 to-orange-600/90 backdrop-blur-xl p-6 text-white border-b border-orange-300/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Zap className="w-8 h-8" />
              <div>
                <h2 className="text-2xl font-bold">Agent Mode</h2>
                <p className="text-orange-100/90">Goal-based AI assistance with planning and execution</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => onModeSelect('tool')}
                className="text-orange-100 hover:text-white hover:bg-white/10 rounded-lg px-3 py-1 text-sm transition-colors"
              >
                Switch to Tool Mode
              </button>
              <button onClick={onClose} className="text-white hover:bg-white/10 rounded-full p-2 backdrop-blur-sm">
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {/* Manual Space/Page Selection UI */}
          {!planSteps.length && !isPlanning && (
            <div className="max-w-4xl mx-auto mb-6">
              <div className="bg-white/60 backdrop-blur-xl rounded-xl p-6 border border-white/20 shadow-lg text-center">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Detected Confluence Context</h3>
                {selectedSpace && selectedPages.length === 1 && (
                  <div className="mb-4 text-green-700 font-semibold">
                    Auto-selected: Space <span className="font-bold">{spaces.find(s => s.key === selectedSpace)?.name || selectedSpace}</span> &nbsp;|&nbsp; Page <span className="font-bold">{selectedPages[0]}</span>
                  </div>
                )}
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
              </div>
              {/* Manual Space/Page Selection UI */}
              <div className="bg-white/60 backdrop-blur-xl rounded-xl p-6 border border-white/20 shadow-lg mt-6 text-left">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Manual Space & Page Selection</h3>
                {/* Space Selection */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Confluence Space
                  </label>
                  <div className="relative">
                    <select
                      value={selectedSpace}
                      onChange={(e) => setSelectedSpace(e.target.value)}
                      className="w-full p-3 border border-white/30 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 appearance-none bg-white/70 backdrop-blur-sm"
                    >
                      <option value="">Choose a space...</option>
                      {spaces.map(space => (
                        <option key={space.key} value={space.key}>{space.name} ({space.key})</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  </div>
                </div>
                {/* Page Selection */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Pages to Analyze
                  </label>
                  <div className="space-y-2 max-h-40 overflow-y-auto border border-white/30 rounded-lg p-2 bg-white/50 backdrop-blur-sm">
                    {pages.map(page => (
                      <label key={page} className="flex items-center space-x-2 p-2 hover:bg-white/30 rounded cursor-pointer backdrop-blur-sm">
                        <input
                          type="checkbox"
                          checked={selectedPages.includes(page)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPages([...selectedPages, page]);
                            } else {
                              setSelectedPages(selectedPages.filter(p => p !== page));
                            }
                          }}
                          className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                        />
                        <span className="text-sm text-gray-700">{page}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center space-x-2 mb-2 mt-2">
                    <input
                      type="checkbox"
                      checked={selectAllPages}
                      onChange={toggleSelectAllPages}
                      className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-sm text-gray-700 font-medium">Select All Pages</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedPages.length} page(s) selected
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Goal Input Section */}
          {!planSteps.length && !isPlanning && (
            <div className="max-w-4xl mx-auto">
              <div className="bg-white/60 backdrop-blur-xl rounded-xl p-8 border border-white/20 shadow-lg text-center">
                <h3 className="text-2xl font-bold text-gray-800 mb-6">What do you want the assistant to help you achieve?</h3>
                <div className="relative">
                  {/* Combined Voice Recorder and Textarea for goal input */}
                  <div className="flex items-start space-x-2 mb-4">
                    <div className="flex-1">
                      <textarea
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                        placeholder="Describe your goal in detail... (e.g., 'Help me analyze our documentation structure and recommend improvements for better user experience')"
                        className="w-full p-4 border-2 border-orange-200/50 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none bg-white/70 backdrop-blur-sm text-lg"
                        rows={4}
                      />
                    </div>
                    <div className="flex flex-col space-y-2">
                      <VoiceRecorder
                        onConfirm={t => setGoal(t)}
                        inputPlaceholder="Speak your goal..."
                        buttonClassName="bg-orange-500/90 text-white hover:bg-orange-600 border-orange-500"
                      />
                      <button
                        onClick={handleGoalSubmit}
                        disabled={!goal.trim() || !selectedSpace || selectedPages.length === 0}
                        className="bg-orange-500/90 backdrop-blur-sm text-white p-3 rounded-lg hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-2 transition-colors border border-white/10"
                      >
                        <Send className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
                {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
              </div>
            </div>
          )}

          {/* History Section */}
          {history.length > 0 && !planSteps.length && !isPlanning && (
            <div className="max-w-4xl mx-auto mt-6">
              <div className="bg-white/60 backdrop-blur-xl rounded-xl p-6 border border-white/20 shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                    <FileText className="w-5 h-5 mr-2 text-orange-500" />
                    Previous Instructions ({history.length})
                  </h3>
                  <div className="flex space-x-2">
                    <button
                      onClick={goToLatest}
                      className="px-3 py-1 bg-orange-500/90 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm font-medium"
                    >
                      Go to Latest
                    </button>
                    <button
                      onClick={toggleHistory}
                      className="px-3 py-1 bg-gray-500/90 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium"
                    >
                      {showHistory ? 'Hide' : 'Show'} History
                    </button>
                  </div>
                </div>
                
                {showHistory && (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {history.map((entry) => (
                      <div
                        key={entry.id}
                        onClick={() => loadHistoryEntry(entry.id)}
                        className={`p-3 rounded-lg cursor-pointer transition-colors border ${
                          currentHistoryId === entry.id
                            ? 'bg-orange-100/80 border-orange-300 text-orange-800'
                            : 'bg-white/50 border-white/30 hover:bg-white/70 text-gray-700'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-sm mb-1 line-clamp-2">
                              {entry.goal.length > 100 ? `${entry.goal.substring(0, 100)}...` : entry.goal}
                            </div>
                            <div className="text-xs text-gray-500">
                              {entry.selectedPages.join(', ')} • {entry.timestamp.toLocaleString()}
                            </div>
                          </div>
                          {currentHistoryId === entry.id && (
                            <div className="ml-2 text-orange-600">
                              <CheckCircle className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Historical Entry Banner */}
          {currentHistoryId && !planSteps.length && (
            <div className="max-w-4xl mx-auto mb-6">
              <div className="bg-orange-100/80 backdrop-blur-xl rounded-xl p-4 border border-orange-200/50 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-orange-600" />
                    <span className="text-orange-800 font-medium">Viewing Previous Instruction</span>
                  </div>
                  <button
                    onClick={goToLatest}
                    className="px-3 py-1 bg-orange-500/90 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm font-medium"
                  >
                    Go to Latest
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Execution Phase */}
          {(planSteps.length > 0 || (currentHistoryId && outputTabs.length > 0)) && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - Progress Timeline or History Info */}
              <div className="lg:col-span-1">
                {currentHistoryId ? (
                  // History Info Panel
                  <div className="bg-white/60 backdrop-blur-xl rounded-xl p-4 border border-white/20 shadow-lg">
                    <h3 className="font-semibold text-gray-800 mb-4 flex items-center">
                      <FileText className="w-5 h-5 mr-2 text-orange-500" />
                      History Details
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2">Original Goal</div>
                        <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                          {goal}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2">Selected Space</div>
                        <div className="text-sm text-gray-600">
                          {spaces.find(s => s.key === selectedSpace)?.name || selectedSpace}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2">Selected Pages</div>
                        <div className="text-sm text-gray-600">
                          {selectedPages.join(', ')}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2">Execution Date</div>
                        <div className="text-sm text-gray-600">
                          {history.find(h => h.id === currentHistoryId)?.timestamp.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    
                    {/* Navigation Buttons */}
                    <div className="mt-6 space-y-2">
                      <button
                        onClick={goToLatest}
                        className="w-full px-3 py-2 bg-orange-500/90 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm font-medium"
                      >
                        Go to Latest
                      </button>
                      <button
                        onClick={() => {
                          setCurrentHistoryId(null);
                          setOutputTabs([]);
                          setGoal('');
                          setActiveResult(null);
                        }}
                        className="w-full px-3 py-2 bg-gray-500/90 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium"
                      >
                        Back to New Instruction
                      </button>
                    </div>
                  </div>
                ) : (
                  // Progress Timeline
                  <div className="bg-white/60 backdrop-blur-xl rounded-xl p-4 border border-white/20 shadow-lg">
                    <h3 className="font-semibold text-gray-800 mb-4">Live Progress Log</h3>
                    <div className="space-y-4">
                      {planSteps.map((step) => (
                        <div key={step.id} className="flex items-start space-x-3">
                          <div className="flex-shrink-0 mt-1">
                            {step.status === 'completed' ? (
                              <CheckCircle className="w-5 h-5 text-green-500" />
                            ) : step.status === 'running' ? (
                              <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
                            ) : (
                              <div className="w-5 h-5 border-2 border-gray-300 rounded-full" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="font-medium text-gray-800">{step.title}</div>
                            {step.details && (
                              <div className="text-sm text-gray-600 mt-1">{step.details}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="mt-6">
                      <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                        <span>Progress</span>
                        <span>{progressPercent}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3 relative">
                        <div 
                          className="bg-gradient-to-r from-orange-400 to-orange-600 h-3 rounded-full transition-all duration-500"
                          style={{ width: `${progressPercent}%` }}
                        />
                        {/* Stage markers */}
                        <div className="absolute left-0 top-0 h-3 w-1 bg-orange-700 rounded-full" title="Start" />
                        <div className="absolute left-1/2 top-0 h-3 w-1 bg-orange-700 rounded-full" style={{ left: '50%' }} title="Analyzed" />
                        <div className="absolute right-0 top-0 h-3 w-1 bg-orange-700 rounded-full" title="Complete" />
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>Start</span>
                        <span>Analyzed</span>
                        <span>Complete</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Columns - Output Tabs */}
              <div className="lg:col-span-2">
                {outputTabs.length > 0 && (
                  <div className="bg-white/60 backdrop-blur-xl rounded-xl border border-white/20 shadow-lg overflow-hidden">
                    {/* Tab Headers */}
                    <div className="border-b border-white/20 bg-white/40 backdrop-blur-sm">
                      <div className="flex overflow-x-auto">
                        {outputTabs.map(tab => {
                          const Icon = tab.icon;
                          return (
                            <button
                              key={tab.id}
                              onClick={() => setActiveTab(tab.id)}
                              className={`flex items-center space-x-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
                                activeTab === tab.id
                                  ? 'border-orange-500 text-orange-600 bg-white/50'
                                  : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-white/30'
                              }`}
                            >
                              <Icon className="w-4 h-4" />
                              <span className="text-sm font-medium">{tab.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Tab Content */}
                    <div className="p-6">
                      {outputTabs.find(tab => tab.id === activeTab) && (
                        <div className="prose prose-sm max-w-none">
                          {activeTab === 'per-page-results' ? (
                            <div>
                              {/* Special Buttons for Impact Analyzer and Test Strategy */}
                              {outputTabs.find(t => t.id === 'per-page-results')?.results?.some((r: any) => 'impactAnalyzerResult' in r) && (
                                <div className="mb-6 flex flex-wrap gap-2">
                                  <button
                                    onClick={() => setActiveResult(activeResult && activeResult.key === 'impact-analyzer' ? null : { type: 'impact-analyzer', key: 'impact-analyzer' })}
                                    className={`px-5 py-2 rounded-lg font-semibold shadow transition-colors border border-orange-200/50 focus:outline-none focus:ring-2 focus:ring-orange-400/60 focus:ring-offset-2 ${
                                      activeResult && activeResult.key === 'impact-analyzer' 
                                        ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white scale-105' 
                                        : 'bg-white/80 text-orange-700 hover:bg-orange-100'
                                    }`}
                                    style={{ minWidth: 180 }}
                                  >
                                    Impact Analyzer
                                  </button>
                                </div>
                              )}
                              {outputTabs.find(t => t.id === 'per-page-results')?.results?.some((r: any) => 'testStrategyResult' in r) && (
                                <div className="mb-6 flex flex-wrap gap-2">
                                  <button
                                    onClick={() => setActiveResult(activeResult && activeResult.key === 'test-strategy' ? null : { type: 'test-strategy', key: 'test-strategy' })}
                                    className={`px-5 py-2 rounded-lg font-semibold shadow transition-colors border border-orange-200/50 focus:outline-none focus:ring-2 focus:ring-orange-400/60 focus:ring-offset-2 ${
                                      activeResult && activeResult.key === 'test-strategy' 
                                        ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white scale-105' 
                                        : 'bg-white/80 text-orange-700 hover:bg-orange-100'
                                    }`}
                                    style={{ minWidth: 180 }}
                                  >
                                    Test Strategy
                                  </button>
                                </div>
                              )}
                              {/* Page Buttons (hide if special button is active) */}
                              {!activeResult || (activeResult.type !== 'impact-analyzer' && activeResult.type !== 'test-strategy') ? (
                                <div className="mb-6 flex flex-wrap gap-2">
                                  {(outputTabs.find(t => t.id === 'per-page-results')?.results || []).map((r: any) => (
                                    (!('impactAnalyzerResult' in r) && !('testStrategyResult' in r)) && (
                                      <button
                                        key={r.page}
                                        onClick={() => setActiveResult(activeResult && activeResult.key === r.page ? null : { type: 'page', key: r.page, page: r.page, instructionIndex: 0 })}
                                        className={`px-5 py-2 rounded-lg font-semibold shadow transition-colors border border-orange-200/50 focus:outline-none focus:ring-2 focus:ring-orange-400/60 focus:ring-offset-2 ${
                                          activeResult && activeResult.key === r.page 
                                            ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white scale-105' 
                                            : 'bg-white/80 text-orange-700 hover:bg-orange-100'
                                        }`}
                                        style={{ minWidth: 120 }}
                                      >
                                        {r.page}
                                      </button>
                                    )
                                  ))}
                                </div>
                              ) : null}
                              {/* Impact Analyzer Result */}
                              {activeResult && activeResult.type === 'impact-analyzer' && (
                                <div className="mt-4">
                                  {(() => {
                                    const impactData = (outputTabs.find(t => t.id === 'per-page-results')?.results || []).find((r: any) => 'impactAnalyzerResult' in r);
                                    if (!impactData || !('impactAnalyzerResult' in impactData)) return null;
                                    return impactData.impactAnalyzerResult;
                                  })()}
                                </div>
                              )}
                              {/* Test Strategy Result */}
                              {activeResult && activeResult.type === 'test-strategy' && (
                                <div className="mt-4">
                                  {(() => {
                                    const testStrategyData = (outputTabs.find(t => t.id === 'per-page-results')?.results || []).find((r: any) => 'testStrategyResult' in r);
                                    if (!testStrategyData || !('testStrategyResult' in testStrategyData)) return null;
                                    return testStrategyData.testStrategyResult;
                                  })()}
                                </div>
                              )}
                              {/* Page Results */}
                              {activeResult && activeResult.type === 'page' && (
                                <div className="mt-4">
                                  {(() => {
                                    const pageData = (outputTabs.find(t => t.id === 'per-page-results')?.results || []).find((r: { page: string, results: Array<{ instruction: string, tool: string, outputs: string[], formattedOutput: string }> }) => r.page === activeResult.page);
                                    if (!pageData) return null;
                                    
                                    return (
                                      <div className="rounded-2xl shadow-xl border border-orange-200/60 bg-white/90 p-6 max-w-4xl mx-auto">
                                        <h3 className="text-2xl font-extrabold text-orange-700 mb-6 flex items-center gap-2">
                                          <FileText className="w-6 h-6 text-orange-400" />
                                          {pageData.page}
                                        </h3>
                                        {(pageData.results || []).map((result: { instruction: string, tool: string, outputs: string[], formattedOutput: string }, index: number) => (
                                          <div key={index} className="mb-8 last:mb-0">
                                            <div className="flex items-center gap-3 mb-4">
                                              <span className="inline-block px-4 py-2 rounded-full bg-orange-100 text-orange-700 text-sm font-bold uppercase tracking-wide shadow-sm border border-orange-200/60">
                                                Instruction {index + 1}
                                              </span>
                                              <span className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                                                {result.tool.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                                              </span>
                                            </div>
                                            <div className="bg-orange-50/80 backdrop-blur-sm rounded-xl p-4 border border-orange-200/40 mb-4">
                                              <h4 className="text-lg font-semibold text-gray-800 mb-2 flex items-center gap-2">
                                                <span className="text-orange-600">📝</span>
                                                "{result.instruction}"
                                              </h4>
                                            </div>
                                            <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-orange-100/60 shadow-inner">
                                              <div className="flex items-center gap-2 mb-4">
                                                <span className="text-orange-600 font-semibold">📊</span>
                                                <span className="text-lg font-semibold text-gray-800">Result</span>
                                              </div>
                                              <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                                                {result.formattedOutput}
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                            </div>
                          ) : activeTab === 'qa' ? (
                            <div>
                              <div className="whitespace-pre-wrap text-gray-700 mb-4">
                                {outputTabs.find(tab => tab.id === activeTab)?.content}
                              </div>
                              {showFollowUp && (
                                <div className="border-t border-white/20 pt-4">
                                  <div className="flex space-x-2">
                                    <div className="flex-1">
                                      <input
                                        type="text"
                                        value={followUpQuestion}
                                        onChange={(e) => setFollowUpQuestion(e.target.value)}
                                        placeholder="Ask a follow-up question..."
                                        className="w-full p-3 border border-white/30 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white/70 backdrop-blur-sm"
                                        onKeyPress={(e) => e.key === 'Enter' && handleFollowUp()}
                                      />
                                    </div>
                                    <div className="flex space-x-2">
                                      <VoiceRecorder
                                        onConfirm={(transcript) => setFollowUpQuestion(transcript)}
                                        inputPlaceholder="Speak your question..."
                                        buttonClassName="bg-orange-500/90 text-white hover:bg-orange-600 border-orange-500"
                                      />
                                      <button
                                        onClick={handleFollowUp}
                                        disabled={!followUpQuestion.trim() || !selectedSpace || selectedPages.length === 0}
                                        className="px-4 py-3 bg-orange-500/90 backdrop-blur-sm text-white rounded-lg hover:bg-orange-600 disabled:bg-gray-300 transition-colors flex items-center border border-white/10"
                                      >
                                        <Plus className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap text-gray-700">
                              {outputTabs.find(tab => tab.id === activeTab)?.content.split('\n').map((line, index) => {
                                if (line.startsWith('### ')) {
                                  return <h3 key={index} className="text-lg font-bold text-gray-800 mt-4 mb-2">{line.substring(4)}</h3>;
                                } else if (line.startsWith('## ')) {
                                  return <h2 key={index} className="text-xl font-bold text-gray-800 mt-6 mb-3">{line.substring(3)}</h2>;
                                } else if (line.startsWith('# ')) {
                                  return <h1 key={index} className="text-2xl font-bold text-gray-800 mt-8 mb-4">{line.substring(2)}</h1>;
                                } else if (line.startsWith('- **')) {
                                  const match = line.match(/- \*\*(.*?)\*\*: (.*)/);
                                  if (match) {
                                    return <p key={index} className="mb-2"><strong>{match[1]}:</strong> {match[2]}</p>;
                                  }
                                } else if (line.startsWith('- ')) {
                                  return <p key={index} className="mb-1 ml-4">• {line.substring(2)}</p>;
                                } else if (line.trim()) {
                                  return <p key={index} className="mb-2 text-gray-700">{line}</p>;
                                }
                                return <br key={index} />;
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          {((planSteps.length > 0 && !isPlanning && !isExecuting) || (currentHistoryId && outputTabs.length > 0)) && (
            <div className="flex justify-end mt-8 space-x-4">
              {currentHistoryId ? (
                <>
                  <button
                    onClick={exportPlan}
                    className="px-6 py-3 bg-orange-500/90 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold shadow-md border border-white/10"
                  >
                    <Download className="w-5 h-5 inline-block mr-2" />
                    Export History
                  </button>
                  <button
                    onClick={goToLatest}
                    className="px-6 py-3 bg-blue-500/90 text-white rounded-lg hover:bg-blue-600 transition-colors font-semibold shadow-md border border-white/10"
                  >
                    <RotateCcw className="w-5 h-5 inline-block mr-2" />
                    Go to Latest
                  </button>
                  <button
                    onClick={() => {
                      setCurrentHistoryId(null);
                      setOutputTabs([]);
                      setGoal('');
                      setActiveResult(null);
                    }}
                    className="px-6 py-3 bg-white/80 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors font-semibold shadow-md border border-gray-200/50"
                  >
                    <RotateCcw className="w-5 h-5 inline-block mr-2" />
                    Back to New Instruction
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={exportPlan}
                    className="px-6 py-3 bg-orange-500/90 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold shadow-md border border-white/10"
                  >
                    <Download className="w-5 h-5 inline-block mr-2" />
                    Export Plan
                  </button>
                  <button
                    onClick={backToChat}
                    className="px-6 py-3 bg-white/80 text-orange-600 rounded-lg hover:bg-orange-100 transition-colors font-semibold shadow-md border border-orange-200/50"
                  >
                    <RotateCcw className="w-5 h-5 inline-block mr-2" />
                    Back to Chat
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentMode; 