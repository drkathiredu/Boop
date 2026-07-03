import React, { createContext, useContext, useState, useMemo } from 'react';
import { defaultLayoutPlugin, BookmarkIcon } from '@react-pdf-viewer/default-layout';

const BookmarksContext = createContext<any[]>([]);

export const MyBookmarks = ({ defaultContent }: { defaultContent: React.ReactNode }) => {
    const aiIndex = useContext(BookmarksContext);
    
    if (aiIndex && aiIndex.length > 0) {
        return (
            <div>
               {aiIndex.map(topic => (
                   <div key={topic.title}>{topic.title}</div>
               ))}
            </div>
        );
    }
    return <>{defaultContent}</>;
};

export const App = () => {
    const [aiIndex, setAiIndex] = useState<any[]>([]);
    
    const layoutPlugin = defaultLayoutPlugin({
        sidebarTabs: (defaultTabs) => [
            defaultTabs[0],
            {
                content: <MyBookmarks defaultContent={defaultTabs[1].content} />,
                icon: <BookmarkIcon />,
                title: 'Bookmarks'
            },
            defaultTabs[2]
        ]
    });

    return (
        <BookmarksContext.Provider value={aiIndex}>
             {/* <Viewer plugins={[layoutPlugin]} /> */}
        </BookmarksContext.Provider>
    );
};
