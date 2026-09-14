const VerticalDashedSeparator = ({
  height,
  color = '#001830',
  backgroundColor,
  borderColor,
}: {
  height: number;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1"
      height={height}
      viewBox={`0 0 1 ${height}`}
      fill="none"
      className={`${backgroundColor ? `${backgroundColor}` : 'bg-transparent'} ${borderColor ? `border-solid border-t border-b ${borderColor}` : 'border-transparent'}`}
    >
      <path
        d={`M0.5 0V${height}`}
        stroke={color}
        strokeOpacity="0.32"
        strokeDasharray="2 2"
      />
    </svg>
  );
};

export default VerticalDashedSeparator;
